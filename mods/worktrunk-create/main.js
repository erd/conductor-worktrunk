// New worktree via worktrunk (`wt`). Opened as a dialog (`mod.open worktrunk-create`,
// bound in keys.json). Takes a branch name, runs
//   wt switch [--create] <branch> --no-cd --format json
// in the focused space's repo, so worktrunk picks the path (its worktree-path
// template) and runs the hooks: pre-start blocks while the dialog waits,
// post-start / post-switch run in the background as usual. Then the new
// checkout opens as a space.
//
// Worktrunk can't prompt here, so project hooks that still need approval are
// listed in the dialog; nothing runs until the person approves them.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { run, props, closeOverlay, theme, spaces, panes, focused, exec, home, notify, settings } from "herdr";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const plain = (s) => (s ?? "").replace(/\x1b\[[0-9;?]*[A-Za-z]/g, "").trim();
const tilde = (p, h) => (h && p.startsWith(h) ? `~${p.slice(h.length)}` : p);
const inside = (p, dir) => p === dir || p.startsWith(dir + "/");

// Where a space is now: its first terminal's live folder, else where it was made.
function place(s) {
  if (!s) return null;
  const tabs = new Set((s.tabs ?? []).map((t) => t.id));
  return panes().find((p) => tabs.has(p.tab) && p.cwd)?.cwd || s.folder || null;
}

async function sh(cmd, args, cwd, on, timeout) {
  try {
    const r = await exec(cmd, args, { cwd, on, ...(timeout ? { timeout } : {}) });
    return { ok: r.code === 0, out: (r.stdout ?? "").trim(), err: plain(r.stderr) };
  } catch (e) {
    return { ok: false, out: "", err: String(e?.message ?? e) };
  }
}

// wt's JSON result is one line on stdout.
function result(out) {
  for (const line of out.split("\n").reverse()) {
    if (!line.startsWith("{")) continue;
    try { return JSON.parse(line); } catch {}
  }
  return null;
}

export default class Worktrunk extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.text = "";
    this.input = InputState.new({ value: "", placeholder: "branch name" });
    this.input.on("change", (_e, cx) => { this.text = this.input.value(); this.error = ""; cx.notify(); });
    this.input.on("submit", (_e, cx) => this.go(cx));
    this.inputFocused = true;
    this.input.on("focus", (_e, cx) => { this.inputFocused = true; cx.notify(); });
    this.input.on("blur", (_e, cx) => { this.inputFocused = false; cx.notify(); });
    this.input.focus();
    cx.timer.after(600, () => this.input.focus());

    this.busy = false;
    this.error = "";
    this.approval = null; // lines describing project commands awaiting approval
    this.repo = undefined; // undefined: looking, null: not in git, else { top, name }

    const f = focused();
    this.space = spaces().find((s) => s.id === f?.space);
    this.on = this.space?.machine ?? null;
    this.folder = (f?.space === this.space?.id && f?.cwd) || place(this.space);

    cx.spawn(async (cx) => {
      this.repo = await this.repoOf(this.folder);
      cx.notify();
    });
  }

  async repoOf(folder) {
    if (!folder) return null;
    const top = await sh("git", ["rev-parse", "--show-toplevel"], folder, this.on);
    const common = await sh("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], folder, this.on);
    if (!top.ok || !common.ok) return null;
    const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
    return { top: top.out, name: main.split("/").pop() };
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.busy || !this.repo) return;
    cx.spawn(async (cx) => this.work(cx, () => (this.approval ? this.approve() : this.create())));
  }

  async work(cx, step) {
    this.busy = true;
    this.error = "";
    cx.notify();
    let done = false;
    try { done = await step(); } catch (e) { this.error = String(e?.message ?? e); }
    this.busy = false;
    if (done) return this.close();
    cx.notify();
  }

  // true when finished (dialog closes); false keeps the dialog open with
  // this.error or this.approval set.
  async create() {
    const branch = this.text.trim();
    if (!branch) { this.error = "Type a branch name."; return false; }
    const top = this.repo.top;
    // An existing branch gets a worktree; a new one is created from the default branch.
    const exists = (await sh("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], top, this.on)).ok;
    const args = ["switch", ...(exists ? [] : ["--create"]), branch, "--no-cd", "--format", "json"];
    const r = await sh("wt", args, top, this.on, 600_000);
    const res = result(r.out);

    if (!res?.path) {
      if (/needs approval/i.test(r.err)) {
        // List every unapproved project command (what `wt config approvals add` would ask about).
        const list = await sh("wt", ["config", "approvals", "add"], top, this.on);
        this.approval = (list.err || r.err).split("\n").filter((l) => l.trim() && !/^[✗↳]/.test(l.trim()));
        this.handle.focus();
        return false;
      }
      this.error = r.err || "wt switch failed.";
      return false;
    }

    // A pre-start hook can fail after the worktree exists: open it anyway, but say so.
    if (!r.ok) notify({ title: `Worktree ${res.branch ?? branch}: a hook failed`, body: r.err.split("\n").slice(-6).join("\n"), level: "warning" });
    this.openSpace(res.path);
    return true;
  }

  async approve() {
    const r = await sh("wt", ["config", "approvals", "add", "--yes"], this.repo.top, this.on);
    if (!r.ok) { this.error = r.err || "Couldn't save approvals."; return false; }
    this.approval = null;
    this.input.focus();
    return this.create();
  }

  openSpace(path) {
    // Already showing it (an existing worktree): go there instead of opening a second space.
    const there = spaces().find((s) => (s.machine ?? null) === this.on && inside(place(s) ?? "", path));
    if (there) run("space.select", { id: there.id });
    else run("space.new", { folder: path, ...(this.on ? { machine: this.on } : {}) });
  }

  key(e, cx) {
    if (e.key === "escape") { cx.stop_propagation(); return this.close(); }
    if (e.key === "enter" && this.approval) { cx.stop_propagation(); return this.go(cx); }
  }

  render() {
    const t = theme();
    const r = this.repo;
    const mono = settings().font_family ?? "JetBrains Mono";
    const title = `New worktree${r ? ` of ${r.name}` : ""}`;
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(12).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)).child(text);

    let body;
    if (r === undefined) body = div().text_color(t.muted).child("…");
    else if (r === null) body = div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, home()) : "The focused space"} is not in a git repository.`);
    else if (this.approval) {
      body = v_flex().gap(8)
        .child(div().text_color(t.muted).child(`Worktrunk needs your approval before running ${r.name}'s project hooks. Approving saves them (as wt config approvals add would).`))
        .child(v_flex().id("wt-approval").max_h(220).overflow_y_scroll().p(10).rounded(6).bg(t.background)
          .font_family(mono).text_size(11.5).text_color(t.foreground)
          .children(this.approval.map((l, i) => div().id(`ap-${i}`).child(l))));
    } else {
      body = v_flex().gap(6)
        .child(Input.new(this.input).h(32).px(10).items_center().rounded(6).border(1)
          .border_color(this.inputFocused ? t.accent : t.input).bg(t.background).text_color(t.foreground))
        .child(div().text_size(11.5).text_color(t.dim).child("A new branch starts from the default branch; an existing one is checked out. Worktrunk's worktree-path decides where it goes."));
    }

    const footer = h_flex().gap(8).items_center().justify_end()
      .when(this.busy, (el) => el.child(h_flex().gap(6).flex_1().text_size(11.5).text_color(t.dim)
        .child(div().frames(SPINNER, 90)).child(this.approval ? "approving…" : "creating worktree, running hooks…")))
      .child(button("wt-cancel", "Cancel", false, () => this.close()))
      .when(Boolean(r) && !this.busy, (el) => el.child(button("wt-go", this.approval ? "Approve and create" : "Create", true, (cx) => this.go(cx))));

    return v_flex().id("worktrunk").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().p(16).gap(12).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(body)
      .when(Boolean(this.error), (el) => el.child(div().font_family(mono).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(footer);
  }
}
