import { Menu, Platform, setIcon, type Plugin } from "obsidian";
import type { StatusPort } from "../core/interfaces";

export class StatusManager implements StatusPort {
  private readonly statusBar = this.plugin.addStatusBarItem();
  private readonly ribbon = this.plugin.addRibbonIcon("cloud", "S3 Sync", (event) => this.openMenu(event));
  private readonly isMobile = Platform.isMobileApp;

  constructor(
    private readonly plugin: Plugin,
    private readonly actions: {
      sync: () => void;
      push: () => void;
      pull: () => void;
      undo: () => void;
      openLog: () => void;
      openMonitor: () => void;
    },
  ) {
    if (this.isMobile) {
      this.statusBar.style.display = "none";
    } else {
      this.statusBar.addClass("mod-clickable");
      this.statusBar.onClickEvent((event) => this.openMenu(event));
    }
    this.setStatus("idle", "Ready");
  }

  setStatus(status: "idle" | "syncing" | "conflict" | "error", detail?: string): void {
    const label =
      status === "idle"
        ? "Synced"
        : status === "syncing"
          ? "Syncing..."
          : status === "conflict"
            ? "Conflict"
            : "Sync error";
    if (!this.isMobile) {
      const fullText = `S3 Sync: ${label}${detail ? ` - ${detail}` : ""}`;
      const compactText = detail ? `S3 Sync: ${label}` : fullText;
      this.statusBar.setText(compactText);
      this.statusBar.setAttribute("aria-label", fullText);
      this.statusBar.setAttribute("title", fullText);
    }
    const syncIcon = status === "idle" ? "cloud" : status === "syncing" ? "refresh-cw" : status === "conflict" ? "alert-triangle" : "cloud-off";
    setIcon(this.ribbon, syncIcon);
  }

  setProgress(current: number, total: number): void {
    if (this.isMobile || total <= 0) {
      return;
    }
    const text = `S3 Sync: Syncing... (${current}/${total})`;
    this.statusBar.setText(text);
    this.statusBar.setAttribute("aria-label", text);
    this.statusBar.setAttribute("title", text);
  }

  private openMenu(event: MouseEvent): void {
    const menu = new Menu();
    menu.addItem((item) => item.setTitle("Sync now").setIcon("refresh-cw").onClick(() => this.actions.sync()));
    menu.addItem((item) => item.setTitle("Force push local -> S3").setIcon("upload").onClick(() => this.actions.push()));
    menu.addItem((item) => item.setTitle("Force pull S3 -> local").setIcon("download").onClick(() => this.actions.pull()));
    menu.addItem((item) => item.setTitle("Undo last push/pull").setIcon("rotate-ccw").onClick(() => this.actions.undo()));
    menu.addSeparator();
    menu.addItem((item) => item.setTitle("Open live monitor").setIcon("activity").onClick(() => this.actions.openMonitor()));
    menu.addItem((item) => item.setTitle("Open sync log").setIcon("list").onClick(() => this.actions.openLog()));
    menu.showAtMouseEvent(event);
  }
}
