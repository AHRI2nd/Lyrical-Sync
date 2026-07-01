import { useEffect, useRef } from "react";
import { Menu, Submenu, MenuItem, PredefinedMenuItem } from "@tauri-apps/api/menu";
import type { Translations } from "../i18n/translations";

// 메뉴 액션 핸들러 — App에서 현재 상태에 묶인 콜백을 넘긴다.
export interface MacMenuHandlers {
  newFile: () => void;
  openLrc: () => void;
  openAudio: () => void;
  save: () => void;
  saveAsLrc: () => void;
  saveAsSrt: () => void;
  undo: () => void;
  redo: () => void;
  togglePlay: () => void;
  skip: (delta: number) => void;
  stop: () => void;
  openSettings: () => void;
  openPreview: () => void;
  openHelp: () => void;
}

export interface MacMenuState {
  t: Translations;
}

const isMac =
  typeof navigator !== "undefined" && navigator.platform.toLowerCase().includes("mac");

// macOS 시스템 메뉴바(애플 로고 우측)에 네이티브 메뉴를 구성한다.
// Windows/Linux에서는 동작하지 않음 (앱 내 헤더 툴바를 그대로 사용).
export function useMacMenu(handlers: MacMenuHandlers, state: MacMenuState) {
  // 핸들러는 ref로 항상 최신값 참조 (메뉴 재생성 없이 액션이 최신 상태를 봄)
  const hRef = useRef(handlers);
  hRef.current = handlers;
  const h = () => hRef.current;

  const { t } = state;

  useEffect(() => {
    if (!isMac) return;
    let cancelled = false;

    (async () => {
      const sep = () => PredefinedMenuItem.new({ item: "Separator" });
      const item = (text: string, action: () => void, accelerator?: string) =>
        MenuItem.new({ text, accelerator, action });

      const appMenu = await Submenu.new({
        text: "Lyrical Sync",
        items: [
          await PredefinedMenuItem.new({ item: { About: null } }),
          await sep(),
          await item(t.menu.settings, () => h().openSettings(), "CmdOrCtrl+,"),
          await sep(),
          await PredefinedMenuItem.new({ item: "Services" }),
          await sep(),
          await PredefinedMenuItem.new({ item: "Hide" }),
          await PredefinedMenuItem.new({ item: "HideOthers" }),
          await PredefinedMenuItem.new({ item: "ShowAll" }),
          await sep(),
          await PredefinedMenuItem.new({ item: "Quit" }),
        ],
      });

      const fileMenu = await Submenu.new({
        text: t.menu.file,
        items: [
          await item(t.newFileBtn, () => h().newFile(), "CmdOrCtrl+N"),
          await item(t.openLrc, () => h().openLrc(), "CmdOrCtrl+O"),
          await item(t.openAudio, () => h().openAudio()),
          await sep(),
          await item(t.save, () => h().save(), "CmdOrCtrl+S"),
          await item(t.menu.saveAsLrc, () => h().saveAsLrc(), "CmdOrCtrl+Shift+S"),
          await item(t.menu.saveAsSrt, () => h().saveAsSrt()),
        ],
      });

      // 문서 단위 실행취소/다시실행은 가속키를 두지 않아 입력칸의 네이티브 텍스트
      // 편집(⌘Z)과 충돌하지 않게 한다. 키보드 ⌘Z는 기존 전역 핸들러가 처리.
      const editMenu = await Submenu.new({
        text: t.menu.edit,
        items: [
          await item(t.undo, () => h().undo()),
          await item(t.redo, () => h().redo()),
          await sep(),
          await PredefinedMenuItem.new({ item: "Cut" }),
          await PredefinedMenuItem.new({ item: "Copy" }),
          await PredefinedMenuItem.new({ item: "Paste" }),
          await PredefinedMenuItem.new({ item: "SelectAll" }),
        ],
      });

      // 재생 항목은 가속키 없음 (앱의 숫자키/Space 단축키와 충돌 방지)
      const playMenu = await Submenu.new({
        text: t.menu.playback,
        items: [
          await item(t.menu.playPause, () => h().togglePlay()),
          await sep(),
          await item(t.menu.skipBack5, () => h().skip(-5)),
          await item(t.menu.skipBack1, () => h().skip(-1)),
          await item(t.menu.skipFwd1, () => h().skip(1)),
          await item(t.menu.skipFwd5, () => h().skip(5)),
          await sep(),
          await item(t.menu.stop, () => h().stop()),
        ],
      });

      const viewMenu = await Submenu.new({
        text: t.menu.view,
        items: [await item(t.previewBtn, () => h().openPreview())],
      });

      const helpMenu = await Submenu.new({
        text: t.menu.help,
        items: [await item(t.shortcutsTitle, () => h().openHelp())],
      });

      const menu = await Menu.new({
        items: [appMenu, fileMenu, editMenu, playMenu, viewMenu, helpMenu],
      });

      if (cancelled) return;
      await menu.setAsAppMenu();
    })();

    return () => {
      cancelled = true;
    };
    // 라벨(언어)이 바뀌면 메뉴 재구성
  }, [t]);
}
