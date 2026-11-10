// Remove the focused space's worktree via worktrunk (`wt remove`), so its
// pre-remove / post-remove hooks run. Opened as a dialog (`mod.open
// worktrunk-delete`, bound in keys.json). Companion to the `worktrunk-create` mod; a
// separate folder because mod.open can't pass props to pick a mode.
//
// Runs `wt remove <path> --foreground --format json` from the main checkout,
// then closes the space(s) sitting in the removed worktree. The branch follows
// worktrunk's rule: deleted if merged, kept otherwise. Uncommitted changes are
// shown as a warning first and then removed with --force, like Herdr's own
// Remove worktree.
//
// Worktrunk can't prompt here, so project hooks that still need approval are
// listed in the dialog; nothing runs until the person approves them.

import { View, div } from "gpui-kit";
import { v_flex, h_flex } from "gpui-base";
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

// `wt remove --format json` prints an array, one object per removal.
function result(out) {
  try { const j = JSON.parse(out.slice(out.indexOf("["))); return Array.isArray(j) ? j[0] : j; } catch { return null; }
}

const KEPT = {
  retained_unmerged: "it isn't merged",
  retained_checked_out: "another worktree has it checked out",
  retained_raced: "it moved during removal",
  retained_failed: "deleting it failed",
};

export default class WorktrunkDelete extends View {
  init(_props, cx) {
    this.handle = cx.focus_handle();
    this.handle.focus();
    cx.timer.after(600, () => this.handle.focus());

    this.busy = false;
    this.error = "";
    this.approval = null; // lines describing project commands awaiting approval
    this.dirty = false;
    this.wt = undefined; // undefined: looking, null: not in git, else { top, main, linked, branch }

    const f = focused();
    this.space = spaces().find((s) => s.id === f?.space);
    this.on = this.space?.machine ?? null;
    this.folder = (f?.space === this.space?.id && f?.cwd) || place(this.space);

    cx.spawn(async (cx) => {
      this.wt = await this.worktreeOf(this.folder);
      if (this.wt?.linked) this.dirty = await this.isDirty();
      cx.notify();
    });
  }

  async worktreeOf(folder) {
    if (!folder) return null;
    const top = await sh("git", ["rev-parse", "--show-toplevel"], folder, this.on);
    const common = await sh("git", ["rev-parse", "--path-format=absolute", "--git-common-dir"], folder, this.on);
    if (!top.ok || !common.ok) return null;
    const main = common.out.endsWith("/.git") ? common.out.slice(0, -5) : common.out;
    const branch = (await sh("git", ["branch", "--show-current"], top.out, this.on)).out;
    return { top: top.out, main, name: main.split("/").pop(), linked: main !== top.out, branch };
  }

  async isDirty() {
    const s = await sh("git", ["--no-optional-locks", "status", "--porcelain"], this.wt.top, this.on);
    return s.ok && s.out !== "";
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(cx) {
    if (this.busy || !this.wt?.linked) return;
    cx.spawn(async (cx) => {
      this.busy = true;
      this.error = "";
      cx.notify();
      let done = false;
      try { done = this.approval ? await this.approve() : await this.remove(); }
      catch (e) { this.error = String(e?.message ?? e); }
      this.busy = false;
      if (done) return this.close();
      cx.notify();
    });
  }

  // true when finished (dialog closes); false keeps it open with this.error or this.approval set.
  async remove() {
    const { top, main } = this.wt;
    // Changes that appeared since the dialog opened get one more warning.
    if (!this.dirty && (await this.isDirty())) {
      this.dirty = true;
      this.error = "It has uncommitted changes now. Remove again to delete them anyway.";
      return false;
    }
    // The spaces sitting in this checkout, picked now: wt remove first moves the
    // folder to .git/wt/trash/<name>-<time>, and shells inside follow the move,
    // so afterwards their live folder no longer matches `top`.
    const doomed = spaces().filter((s) => (s.machine ?? null) === this.on && inside(place(s) ?? "", top)).map((s) => s.id);
    const args = ["remove", top, "--foreground", "--format", "json", ...(this.dirty ? ["--force"] : [])];
    const r = await sh("wt", args, main, this.on, 600_000);

    if (!r.ok) {
      if (/needs approval/i.test(r.err)) {
        const list = await sh("wt", ["config", "approvals", "add"], main, this.on);
        this.approval = (list.err || r.err).split("\n").filter((l) => l.trim() && !/^[✗↳]/.test(l.trim()));
        return false;
      }
      this.error = r.err || "wt remove failed.";
      return false;
    }

    // Close the spaces that were sitting in the removed checkout (their shells' folder is gone).
    for (const id of doomed) if (spaces().some((s) => s.id === id)) run("space.close", { id, confirmed: true });
    const res = result(r.out);
    const why = KEPT[res?.branch_outcome];
    if (why) notify({ title: `Removed worktree ${res.branch ?? ""}`.trim(), body: `Branch kept: ${why}.`, level: "info" });
    return true;
  }

  async approve() {
    const r = await sh("wt", ["config", "approvals", "add", "--yes"], this.wt.main, this.on);
    if (!r.ok) { this.error = r.err || "Couldn't save approvals."; return false; }
    this.approval = null;
    return this.remove();
  }

  key(e, cx) {
    if (e.key === "escape") { cx.stop_propagation(); return this.close(); }
    if (e.key === "enter") { cx.stop_propagation(); return this.go(cx); }
  }

  render() {
    const t = theme();
    const w = this.wt;
    const mono = settings().font_family ?? "JetBrains Mono";
    const button = (id, text, primary, action) => h_flex().id(id).h(30).px(12).items_center().rounded(7)
      .border_1().border_color(primary ? t.solid : t.input).bg(primary ? t.solid : t.raised)
      .text_color(primary ? t.solid_foreground : t.foreground).text_size(12.5).font_medium().cursor_pointer()
      .hover((s) => s.opacity(0.88)).on_click((_e, cx) => action(cx)).child(text);

    const title = w?.linked ? `Remove worktree ${w.branch || tilde(w.top, home())}?` : "Remove worktree";
    let body;
    if (w === undefined) body = div().text_color(t.muted).child("…");
    else if (w === null) body = div().text_color(t.muted).child(`${this.folder ? tilde(this.folder, home()) : "The focused space"} is not in a git repository.`);
    else if (!w.linked) body = div().text_color(t.muted).child(`This is ${w.name}'s main checkout, not a worktree.`);
    else if (this.approval) {
      body = v_flex().gap(8)
        .child(div().text_color(t.muted).child(`Worktrunk needs your approval before running ${w.name}'s project hooks. Approving saves them (as wt config approvals add would).`))
        .child(v_flex().id("wt-approval").max_h(220).overflow_y_scroll().p(10).rounded(6).bg(t.background)
          .font_family(mono).text_size(11.5).text_color(t.foreground)
          .children(this.approval.map((l, i) => div().id(`ap-${i}`).child(l))));
    } else {
      body = v_flex().gap(6)
        .child(div().text_color(t.muted).child(`Runs wt remove with its hooks, deletes ${tilde(w.top, home())} and closes the space. The branch is deleted if it's merged, otherwise kept.`))
        .when(this.dirty, (el) => el.child(div().text_color(t.blocked).child("It has uncommitted changes: they will be lost.")));
    }

    const ready = Boolean(w?.linked) && !this.busy;
    const footer = h_flex().gap(8).items_center().justify_end()
      .when(this.busy, (el) => el.child(h_flex().gap(6).flex_1().text_size(11.5).text_color(t.dim)
        .child(div().frames(SPINNER, 90)).child(this.approval ? "approving…" : "removing, running hooks…")))
      .child(button("wt-cancel", "Cancel", false, () => this.close()))
      .when(ready, (el) => el.child(button("wt-go", this.approval ? "Approve and remove" : "Remove", true, (cx) => this.go(cx))));

    return v_flex().id("worktrunk-delete").track_focus(this.handle).on_key_down((e, cx) => this.key(e, cx))
      .w_full().p(16).gap(12).bg(t.popover).text_size(13).text_color(t.foreground)
      .child(h_flex().items_center().child(div().flex_1().font_semibold().child(title)).child(div().text_size(11).text_color(t.dim).child("Esc")))
      .child(body)
      .when(Boolean(this.error), (el) => el.child(div().font_family(mono).text_size(11.5).text_color(t.blocked).child(this.error)))
      .child(footer);
  }
}
