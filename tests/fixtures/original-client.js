window.__ModuleLoader__.load({id:"dsh-input-assistant",factory:(require)=>{
var module={exports:{}};var exports=module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/browser/index.ts
var index_exports = {};
__export(index_exports, {
  BrowserRuntime: () => BrowserRuntime,
  InputAssistantController: () => InputAssistantController,
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/browser/components.tsx
var import_react = require("react");
var import_react_dom = require("react-dom");

// src/core/diff.ts
var tokenPattern = /(\s+|[^\p{L}\p{N}_]|[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}])/u;
var split = (text) => text.split(tokenPattern).filter(Boolean);
var coarsePattern = /(\n+|[。！？；，、.!?;]+\s*)/u;
var splitCoarse = (text) => text.split(coarsePattern).filter(Boolean);
var MAX_CELLS = 1e6;
function diffTokens(a, b) {
  const result = [];
  const push = (type, value) => {
    if (!value) return;
    const last = result[result.length - 1];
    if (last?.type === type) last.value += value;
    else result.push({ type, value });
  };
  const rows = Array.from({ length: a.length + 1 }, () => new Uint32Array(b.length + 1));
  for (let i2 = a.length - 1; i2 >= 0; i2--) {
    for (let j2 = b.length - 1; j2 >= 0; j2--) {
      rows[i2][j2] = a[i2] === b[j2] ? rows[i2 + 1][j2 + 1] + 1 : Math.max(rows[i2 + 1][j2], rows[i2][j2 + 1]);
    }
  }
  let i = 0, j = 0;
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      push("equal", a[i++]);
      j++;
    } else if (i < a.length && (j === b.length || rows[i + 1][j] >= rows[i][j + 1])) push("delete", a[i++]);
    else push("insert", b[j++]);
  }
  return result;
}
function diffText(before, after) {
  if (before === after) return [{ type: "equal", value: before }];
  const a = split(before), b = split(after);
  let head = 0, tail = 0;
  while (head < a.length && head < b.length && a[head] === b[head]) head++;
  while (tail < a.length - head && tail < b.length - head && a[a.length - tail - 1] === b[b.length - tail - 1]) tail++;
  const middleA = a.slice(head, a.length - tail), middleB = b.slice(head, b.length - tail);
  const result = [];
  const push = (type, value) => {
    if (!value) return;
    const last = result[result.length - 1];
    if (last?.type === type) last.value += value;
    else result.push({ type, value });
  };
  push("equal", a.slice(0, head).join(""));
  if (middleA.length === 0) push("insert", middleB.join(""));
  else if (middleB.length === 0) push("delete", middleA.join(""));
  else if (middleA.length * middleB.length <= MAX_CELLS) for (const part of diffTokens(middleA, middleB)) push(part.type, part.value);
  else {
    const coarseA = splitCoarse(middleA.join("")), coarseB = splitCoarse(middleB.join(""));
    if (coarseA.length * coarseB.length <= MAX_CELLS) for (const part of diffTokens(coarseA, coarseB)) push(part.type, part.value);
    else {
      push("delete", middleA.join(""));
      push("insert", middleB.join(""));
    }
  }
  push("equal", tail ? a.slice(a.length - tail).join("") : "");
  return result;
}

// src/browser/dom.ts
var CHIP_SELECTOR = "[data-composer-chip],[data-composer-text-ref],[data-composer-command]";
function findEditor(anchor) {
  return anchor?.closest("[data-composer-card]")?.querySelector("[data-composer-input]") ?? null;
}
function focusedIn(editor) {
  return editor !== null && (document.activeElement === editor || editor.contains(document.activeElement));
}
function referenceOverlaps(span, references) {
  let shrink = 0;
  for (const reference of references) {
    const start = reference.offset - shrink;
    if (span.start < start + 1 && span.end > start) return true;
    shrink += reference.length - 1;
  }
  return false;
}
function clipboardOffset(detectOffset, references) {
  let shrink = 0;
  for (const reference of references) {
    const start = reference.offset - shrink;
    if (detectOffset <= start) break;
    shrink += reference.length - 1;
  }
  return detectOffset + shrink;
}
function selectedPlainText(editor, draft, span, references) {
  if (span.start === span.end) return null;
  if (referenceOverlaps(span, references)) return null;
  const selection = editor?.ownerDocument.getSelection();
  if (!editor || !selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (!editor.contains(range.startContainer) || !editor.contains(range.endContainer)) return null;
  for (const chip of editor.querySelectorAll(CHIP_SELECTOR)) {
    if (range.intersectsNode(chip)) return null;
  }
  const clipboardStart = clipboardOffset(span.start, references);
  const clipboardEnd = clipboardOffset(span.end, references);
  const text = draft.slice(clipboardStart, clipboardEnd);
  if (!text) return null;
  if (references.length && range.toString() !== text) return null;
  return { text, clipboardStart, clipboardEnd };
}
function measureGhost(editor, empty) {
  if (!editor || !focusedIn(editor)) return null;
  const editorBox = editor.getBoundingClientRect();
  if (editorBox.width <= 0 || editorBox.height <= 0) return null;
  const style = getComputedStyle(editor);
  const selection = editor.ownerDocument.getSelection();
  let rect = null;
  if (selection?.rangeCount === 1) {
    const range = selection.getRangeAt(0);
    if (!range.collapsed || !editor.contains(range.startContainer)) return null;
    if (typeof range.getBoundingClientRect === "function") {
      const measured = range.getBoundingClientRect();
      if (measured.height > 0 && measured.left >= editorBox.left - 1 && measured.left <= editorBox.right + 1) rect = measured;
    }
    if (!rect && !empty && range.startContainer.nodeType === Node.TEXT_NODE && range.startOffset > 0) {
      const preceding = range.cloneRange();
      preceding.setStart(range.startContainer, range.startOffset - 1);
      const last = preceding.getBoundingClientRect();
      if (last.height > 0) rect = new DOMRect(last.right, last.top, 0, last.height);
    }
  }
  if (!rect && empty) {
    rect = new DOMRect(editorBox.left + parseFloat(style.paddingLeft || "0"), editorBox.top + parseFloat(style.paddingTop || "0"), 0, parseFloat(style.lineHeight) || parseFloat(style.fontSize));
  }
  if (!rect) return null;
  const viewport = window.visualViewport;
  const visible = {
    left: Math.max(editorBox.left, viewport?.offsetLeft ?? 0),
    top: Math.max(editorBox.top, viewport?.offsetTop ?? 0),
    right: Math.min(editorBox.right, (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth)),
    bottom: Math.min(editorBox.bottom, (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight))
  };
  for (let ancestor = editor.parentElement; ancestor && ancestor !== document.body; ancestor = ancestor.parentElement) {
    const clipping = getComputedStyle(ancestor);
    const paint = /paint|strict|content/.test(clipping.contain);
    const clipX = paint || /hidden|clip|auto|scroll/.test(clipping.overflowX || clipping.overflow);
    const clipY = paint || /hidden|clip|auto|scroll/.test(clipping.overflowY || clipping.overflow);
    if (clipX || clipY) {
      const box = ancestor.getBoundingClientRect();
      if (clipX) {
        visible.left = Math.max(visible.left, box.left);
        visible.right = Math.min(visible.right, box.right);
      }
      if (clipY) {
        visible.top = Math.max(visible.top, box.top);
        visible.bottom = Math.min(visible.bottom, box.bottom);
      }
    }
  }
  if (rect.left < visible.left - 1 || rect.top < visible.top - 1 || rect.bottom > visible.bottom + 1) return null;
  const width = Math.min(editorBox.right - parseFloat(style.paddingRight || "0"), visible.right) - rect.left;
  if (width < 24) return null;
  return {
    left: rect.left,
    top: rect.top,
    width,
    maxHeight: visible.bottom - rect.top,
    font: style.font,
    lineHeight: style.lineHeight,
    letterSpacing: style.letterSpacing
  };
}
function nativeMenuOpen(editor) {
  const scope = editor?.closest("[data-composer-seat]") ?? editor?.closest("[data-composer-card]");
  return Boolean(scope?.querySelector('[data-trigger-menu],[role="listbox"]'));
}
function canUseTab(event, editor, composing) {
  return event.key === "Tab" && !event.defaultPrevented && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey && !event.isComposing && event.keyCode !== 229 && !composing && focusedIn(editor) && !editor?.hasAttribute("data-composer-composing") && !nativeMenuOpen(editor);
}

// src/browser/floating.ts
function placeFloating(anchor, contentHeight, viewport, preferredWidth = 440) {
  const margin = 12, gap = 8;
  const width = Math.max(1, Math.min(preferredWidth, viewport.width - margin * 2));
  const left = Math.max(viewport.left + margin, Math.min(anchor.right - width, viewport.left + viewport.width - margin - width));
  const above = Math.max(0, anchor.top - viewport.top - margin - gap);
  const below = Math.max(0, viewport.top + viewport.height - margin - anchor.bottom - gap);
  const maximum = Math.max(1, Math.min(560, viewport.height - margin * 2));
  const useAbove = above >= Math.min(contentHeight, maximum) || above >= below;
  const room = useAbove ? above : below;
  if (room < Math.min(120, maximum)) return { left, top: viewport.top + margin, width, maxHeight: maximum };
  const maxHeight = Math.min(maximum, room);
  const height = Math.min(Math.max(1, contentHeight), maxHeight);
  const top = useAbove ? anchor.top - gap - height : anchor.bottom + gap;
  return { left, top: Math.max(viewport.top + margin, top), width, maxHeight };
}

// src/browser/components.tsx
var import_jsx_runtime = require("react/jsx-runtime");
var EMPTY_MODEL = { current: null };
var noopSubscribe = () => () => {
};
function useFloatingPlacement(anchor, surface, visible, card = false) {
  const [placement, setPlacement] = (0, import_react.useState)(null);
  (0, import_react.useLayoutEffect)(() => {
    if (!visible) {
      setPlacement(null);
      return;
    }
    const update = () => {
      const trigger = card ? findEditor(anchor.current)?.closest("[data-composer-card]") : anchor.current;
      const element = surface.current;
      if (!trigger || !element) return;
      const viewport = window.visualViewport;
      const bounds = {
        left: viewport?.offsetLeft ?? 0,
        top: viewport?.offsetTop ?? 0,
        width: viewport?.width ?? window.innerWidth,
        height: viewport?.height ?? window.innerHeight
      };
      const rect = trigger.getBoundingClientRect();
      const next = placeFloating(
        rect,
        element.scrollHeight || element.getBoundingClientRect().height || 160,
        bounds,
        card ? Math.min(640, rect.width || 440) : 460
      );
      setPlacement((previous) => previous && Object.keys(next).every((key) => previous[key] === next[key]) ? previous : next);
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    window.visualViewport?.addEventListener("resize", update);
    window.visualViewport?.addEventListener("scroll", update);
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    if (surface.current) observer?.observe(surface.current);
    if (anchor.current) observer?.observe(anchor.current);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      window.visualViewport?.removeEventListener("resize", update);
      window.visualViewport?.removeEventListener("scroll", update);
      observer?.disconnect();
    };
  }, [anchor, surface, visible, card]);
  return placement;
}
function useController(runtime, sessionId) {
  const controller = (0, import_react.useMemo)(() => runtime.controllerFor(sessionId), [runtime, sessionId]);
  const state = (0, import_react.useSyncExternalStore)(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  (0, import_react.useEffect)(() => runtime.retain(sessionId), [runtime, sessionId]);
  return { controller, state };
}
function AssistantRight({ runtime, sessionId, useInput, useSession, inputActions }) {
  const { controller, state } = useController(runtime, sessionId);
  const input = useInput((value) => value);
  const running = useSession((value) => value.running);
  const removed = useSession((value) => value.removed);
  const generation = (0, import_react.useSyncExternalStore)(
    runtime.connection.generation.subscribe.bind(runtime.connection.generation),
    () => runtime.transport.generation(),
    () => null
  );
  const directory = (0, import_react.useMemo)(() => runtime.models?.directoryFor(sessionId), [runtime, sessionId]);
  const model = (0, import_react.useSyncExternalStore)(
    directory?.store.subscribe.bind(directory.store) ?? noopSubscribe,
    directory?.store.getSnapshot.bind(directory.store) ?? (() => EMPTY_MODEL),
    () => EMPTY_MODEL
  );
  const anchor = (0, import_react.useRef)(null);
  const menuRef = (0, import_react.useRef)(null);
  const noticeRef = (0, import_react.useRef)(null);
  const [open, setOpen] = (0, import_react.useState)(false);
  const [activeTab, setActiveTab] = (0, import_react.useState)("actions");
  const menuPlacement = useFloatingPlacement(anchor, menuRef, open);
  const noticePlacement = useFloatingPlacement(anchor, noticeRef, !open && Boolean(state.notice));
  const [provider, setProvider] = (0, import_react.useState)(state.settings.provider);
  const [modelId, setModelId] = (0, import_react.useState)(state.settings.model);
  (0, import_react.useEffect)(() => {
    void directory?.load().catch(() => {
    });
  }, [directory]);
  (0, import_react.useEffect)(() => {
    if (!state.notice) return;
    const timer = setTimeout(() => {
      controller.clearNotice();
    }, 3500);
    return () => clearTimeout(timer);
  }, [state.notice, controller]);
  (0, import_react.useEffect)(() => {
    setProvider(state.settings.provider);
    setModelId(state.settings.model);
  }, [state.settings.provider, state.settings.model]);
  (0, import_react.useLayoutEffect)(() => {
    if (removed) {
      controller.dispose();
      return;
    }
    controller.bind({ sessionId, input, actions: inputActions, running, editor: findEditor(anchor.current), route: model.current ?? void 0 });
  }, [controller, sessionId, input, inputActions, running, model.current, removed, generation]);
  (0, import_react.useEffect)(() => {
    const editor = findEditor(anchor.current);
    if (!editor) return;
    const selectionChanged = () => controller.notifySelectionChange();
    const compositionStart = () => controller.setComposing(true);
    const compositionEnd = () => controller.setComposing(false);
    const keyDown = (event) => {
      if (!controller.getSnapshot().suggestion || !canUseTab(event, editor, false)) return;
      if (![...document.querySelectorAll("[data-dsh-ia-visible-suggestion]")].some((node) => node.getAttribute("data-dsh-ia-session") === sessionId)) return;
      if (controller.acceptSuggestion()) event.preventDefault();
    };
    document.addEventListener("selectionchange", selectionChanged);
    editor.addEventListener("focus", selectionChanged);
    editor.addEventListener("blur", selectionChanged);
    editor.addEventListener("compositionstart", compositionStart);
    editor.addEventListener("compositionend", compositionEnd);
    window.addEventListener("keydown", keyDown);
    return () => {
      document.removeEventListener("selectionchange", selectionChanged);
      editor.removeEventListener("focus", selectionChanged);
      editor.removeEventListener("blur", selectionChanged);
      editor.removeEventListener("compositionstart", compositionStart);
      editor.removeEventListener("compositionend", compositionEnd);
      window.removeEventListener("keydown", keyDown);
    };
  }, [controller, sessionId]);
  (0, import_react.useEffect)(() => {
    if (!open) return;
    const close = (event) => {
      if (event.target instanceof Node && !anchor.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false);
    };
    const escape = (event) => {
      if (event.key === "Escape" && !event.defaultPrevented) {
        setOpen(false);
        event.preventDefault();
      }
    };
    document.addEventListener("pointerdown", close);
    window.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", close);
      window.removeEventListener("keydown", escape);
    };
  }, [open]);
  const preserveSelection = (event) => {
    event.preventDefault();
  };
  const canEdit = input.phase === "plain" && !state.busy && !state.settingsSaving;
  const canOptimize = canEdit && state.settings.optimizeEnabled;
  const pure = !input.occurrences.length && !input.attachmentIds.length;
  const canSuggest = canEdit && pure && state.connected && !running && !state.status?.running;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ia dsh-ia-root", ref: anchor, "data-dsh-input-assistant": "", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        className: "dsh-ia-trigger",
        type: "button",
        disabled: !canOptimize || !input.draft.trim() || !state.connected,
        onPointerDown: preserveSelection,
        onClick: () => {
          void controller.optimize();
        },
        title: "\u6709\u9009\u533A\u65F6\u4F18\u5316\u9009\u533A\uFF0C\u5426\u5219\u4F18\u5316\u6574\u7A3F",
        children: state.busy === "optimize" ? "\u4F18\u5316\u4E2D\u2026" : "\u4F18\u5316"
      }
    ),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "button",
      {
        className: "dsh-ia-trigger dsh-ia-predict-btn",
        type: "button",
        disabled: !canSuggest,
        onPointerDown: preserveSelection,
        onClick: () => {
          void controller.triggerSuggestion();
        },
        title: input.draft.trim() ? "\u4F9D\u636E\u5F53\u524D\u8349\u7A3F\u987A\u7545\u7EED\u5199\u540E\u7EED\u5185\u5BB9\u5E76\u5C31\u5730\u586B\u5165" : "\u4F9D\u636E\u6700\u65B0\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u9884\u6D4B\u4E0B\u4E00\u53E5\u5E76\u5C31\u5730\u586B\u5165",
        children: "\u9884\u6D4B"
      }
    ),
    state.busy && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dsh-ia-cancel-btn", type: "button", onClick: () => controller.cancelOperation(), children: "\u53D6\u6D88" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { className: "dsh-ia-menu-btn", type: "button", "aria-label": "\u8F93\u5165\u52A9\u624B\u83DC\u5355", "aria-expanded": open, onPointerDown: preserveSelection, onClick: () => setOpen((value) => !value), children: "\u25BE" }),
    !open && state.notice && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "div",
      {
        ref: noticeRef,
        role: "status",
        className: "dsh-ia dsh-ia-notice",
        style: {
          position: "fixed",
          right: "24px",
          bottom: "24px",
          zIndex: 1002,
          visibility: "visible"
        },
        onClick: () => controller.clearNotice(),
        children: state.notice
      }
    ), document.body),
    open && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { ref: menuRef, className: "dsh-ia dsh-ia-menu", "aria-label": "\u8F93\u5165\u52A9\u624B", style: menuPlacement ?? { visibility: "hidden" }, children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("strong", { children: "\u8F93\u5165\u52A9\u624B" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-muted", children: "\u5F53\u524D\u4F1A\u8BDD \xB7 \u91C7\u7EB3\u540E\u7531\u4F60\u53D1\u9001" }),
      state.settingsSaving && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { role: "status", children: "\u8BBE\u7F6E\u4FDD\u5B58\u4E2D\u2026" }),
      state.notice && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-notice", role: "status", children: state.notice }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "\u4F18\u5316\u5F3A\u5EA6 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "select",
          {
            "aria-label": "\u4F18\u5316\u5F3A\u5EA6",
            value: state.settings.optimizationStrength,
            disabled: state.settingsSaving || !state.settings.optimizeEnabled,
            onChange: (event) => {
              void controller.updateSettings({ optimizationStrength: event.target.value });
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "light", children: "\u8F7B\u5EA6\u6DA6\u8272" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "standard", children: "\u6807\u51C6\u4F18\u5316" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "deep", children: "\u6DF1\u5EA6\u68B3\u7406" })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
        "\u9884\u6D4B\u8BE6\u7565\u5EA6 ",
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
          "select",
          {
            "aria-label": "\u9884\u6D4B\u8BE6\u7565\u5EA6",
            value: state.settings.predictionDetail ?? "standard",
            disabled: state.settingsSaving,
            onChange: (event) => {
              void controller.updateSettings({ predictionDetail: event.target.value });
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "concise", children: "\u7B80\u660E" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "standard", children: "\u6807\u51C6" }),
              /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "detailed", children: "\u8BE6\u5C3D" })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ia-row", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("button", { type: "button", disabled: !canOptimize, onPointerDown: preserveSelection, onClick: () => controller.lockSelection(), children: [
          "\u4FDD\u62A4\u9009\u4E2D\u539F\u6587",
          state.locked.length ? ` (${state.locked.length})` : ""
        ] }),
        state.locked.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => controller.clearLocks(), children: "\u6E05\u9664\u4FDD\u62A4" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-muted", children: "\u4EE3\u7801\u3001\u8DEF\u5F84\u548C\u7F51\u5740\u81EA\u52A8\u4FDD\u62A4\uFF1B\u624B\u52A8\u4FDD\u62A4\u5728\u7F16\u8F91\u8349\u7A3F\u540E\u6E05\u9664\u3002" }),
      state.change && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u67E5\u770B\u6539\u52A8" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-pre dsh-ia-diff", children: diffText(state.change.beforeTarget, state.change.afterTarget).map((part, index) => part.type === "insert" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("ins", { children: part.value }, index) : part.type === "delete" ? /* @__PURE__ */ (0, import_jsx_runtime.jsx)("del", { children: part.value }, index) : /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { children: part.value }, index)) }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ia-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !controller.canRestore(), onPointerDown: preserveSelection, onClick: () => controller.restoreOriginal(), children: "\u8FD8\u539F" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
            void copyText(state.change.beforeTarget, controller);
          }, children: "\u590D\u5236\u539F\u6587" })
        ] }),
        !controller.canRestore() && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-muted", children: "\u8349\u7A3F\u5DF2\u6709\u65B0\u7F16\u8F91\uFF0C\u539F\u6587\u4ECD\u53EF\u590D\u5236\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("h4", { children: "\u8F93\u5165\u5EFA\u8BAE" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ia-row", children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", disabled: state.settingsSaving, checked: state.settings.nextEnabled, onChange: (event) => {
              void controller.updateSettings({ nextEnabled: event.target.checked });
            } }),
            "\u56DE\u590D\u540E\u9884\u6D4B"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { type: "checkbox", disabled: state.settingsSaving, checked: state.settings.completionEnabled, onChange: (event) => {
              void controller.updateSettings({ completionEnabled: event.target.checked });
            } }),
            "\u8F93\u5165\u7EED\u5199"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { children: [
          "\u663E\u793A\u65B9\u5F0F ",
          /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("select", { "aria-label": "\u663E\u793A\u65B9\u5F0F", disabled: state.settingsSaving, value: state.settings.displayMode, onChange: (event) => {
            void controller.updateSettings({ displayMode: event.target.value });
          }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "ghost", children: "\u7070\u5B57" }),
            /* @__PURE__ */ (0, import_jsx_runtime.jsx)("option", { value: "panel", children: "\u5019\u9009\u9762\u677F" })
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-row", children: /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => controller.dismissSuggestion(), children: "\u6682\u505C\u81F3\u4E0B\u6B21\u7F16\u8F91" }) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("h4", { children: [
          "\u8349\u7A3F\u6682\u5B58 (",
          state.drafts.length,
          "/3)"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !state.settings.stashEnabled || !canEdit || !pure || !input.draft.trim() || state.drafts.length >= 3, onPointerDown: preserveSelection, onClick: () => {
          void controller.stash();
        }, children: "\u6682\u5B58\u5E76\u6E05\u7A7A" }),
        !state.settings.stashEnabled && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-ia-muted", children: "\u6682\u5B58\u5DF2\u5173\u95ED\uFF1B\u5386\u53F2\u8349\u7A3F\u4ECD\u53EF\u67E5\u770B\u548C\u5220\u9664\uFF0C\u91CD\u65B0\u542F\u7528\u540E\u53EF\u6062\u590D\u3002" }),
        !pure && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-ia-muted", children: "\u6682\u5B58\u548C\u6062\u590D\u4EC5\u652F\u6301\u65E0\u5F15\u7528\u3001\u65E0\u9644\u4EF6\u7684\u7EAF\u6587\u672C\u8349\u7A3F\u3002" }),
        state.drafts.map((draft) => /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
          DraftCard,
          {
            draft,
            controller,
            canEdit: state.settings.stashEnabled && canEdit && pure,
            canReplace: state.settings.stashEnabled && canEdit && pure && Boolean(input.draft.trim()) && state.drafts.length >= 3
          },
          draft.id
        )),
        state.drafts.length === 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-ia-muted", children: "\u6682\u5B58\u540E\u53EF\u4EE5\u5148\u8FFD\u95EE\u522B\u7684\uFF0C\u518D\u627E\u56DE\u539F\u6765\u7684\u8349\u7A3F\u3002" }),
        state.drafts.length > 0 && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
          void controller.clearDrafts();
        }, children: "\u6E05\u7A7A\u6682\u5B58" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u8F85\u52A9\u6A21\u578B\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-muted", children: "\u4E24\u9879\u7559\u7A7A\u65F6\u8DDF\u968F\u8F93\u5165\u6846\u6A21\u578B\uFF1B\u8F85\u52A9\u8C03\u7528\u5355\u72EC\u6D88\u8017\u6A21\u578B\u7528\u91CF\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u63D0\u4F9B\u5546",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: state.settingsSaving, value: provider, onChange: (event) => setProvider(event.target.value), placeholder: "\u8DDF\u968F\u8F93\u5165\u6846", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u6A21\u578B",
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("input", { disabled: state.settingsSaving, value: modelId, onChange: (event) => setModelId(event.target.value), placeholder: "\u8DDF\u968F\u8F93\u5165\u6846", autoComplete: "off" })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: state.settingsSaving, onClick: () => {
          void controller.updateSettings({ provider, model: modelId });
        }, children: "\u4FDD\u5B58\u6A21\u578B\u8BBE\u7F6E" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: "\u672C\u6B21\u4F7F\u7528\u7EDF\u8BA1" }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("p", { className: "dsh-ia-muted", children: [
          "\u5F53\u524D\u4F1A\u8BDD\uFF1A\u5C55\u793A ",
          state.metrics.exposures,
          " \u6B21\uFF0C\u91C7\u7EB3 ",
          state.metrics.accepted,
          " \u6B21\uFF0C \u91C7\u7EB3\u540E\u7EE7\u7EED\u7F16\u8F91 ",
          state.metrics.editedAcceptances,
          " \u6B21\uFF0C\u7F16\u8F91\u5B57\u6570\u7EA6 ",
          state.metrics.editedCharacters,
          "\uFF0C\u8F85\u52A9\u8C03\u7528 ",
          state.metrics.calls,
          " \u6B21\u3002"
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-muted", children: "\u4EC5\u4FDD\u7559\u5728\u672C\u6B21\u63D2\u4EF6\u8FD0\u884C\u5185\uFF0C\u4E0D\u4E0A\u4F20\uFF1B\u5FFD\u7565\u5EFA\u8BAE\u4E0D\u4F1A\u88AB\u89C6\u4E3A\u8D1F\u53CD\u9988\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("p", { className: "dsh-ia-muted", children: "\u66F4\u591A\u8BBE\u7F6E\uFF1ADSH \u8BBE\u7F6E \u2192 \u8F93\u5165\u52A9\u624B" })
    ] }), document.body)
  ] });
}
function DraftCard({ draft, controller, canEdit, canReplace }) {
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("details", { className: "dsh-ia-draft", children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("summary", { children: draft.text.split("\n")[0].slice(0, 50) || "\u672A\u547D\u540D\u8349\u7A3F" }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("time", { children: new Date(draft.createdAt).toLocaleString() }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { className: "dsh-ia-pre", children: draft.text }),
    /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { className: "dsh-ia-row", children: [
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !canEdit, onPointerDown: (event) => event.preventDefault(), onClick: () => controller.restoreDraft(draft, "append"), children: "\u8FFD\u52A0" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", disabled: !canEdit, onPointerDown: (event) => event.preventDefault(), onClick: () => controller.restoreDraft(draft, "replace"), children: "\u66FF\u6362" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
        void copyText(draft.text, controller, "\u8349\u7A3F\u5DF2\u590D\u5236");
      }, children: "\u590D\u5236" }),
      /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onClick: () => {
        void controller.deleteDraft(draft.id);
      }, children: "\u5220\u9664" }),
      canReplace && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onPointerDown: (event) => event.preventDefault(), onClick: () => {
        void controller.stash(draft.id);
      }, children: "\u8986\u76D6\u6B64\u6761" })
    ] })
  ] });
}
async function copyText(text, controller, successMsg = "\u539F\u6587\u5DF2\u590D\u5236") {
  try {
    await navigator.clipboard.writeText(text);
    controller.notice(successMsg);
  } catch {
    controller.notice("\u590D\u5236\u4E0D\u53EF\u7528\uFF0C\u8BF7\u5728\u6539\u52A8\u9762\u677F\u624B\u52A8\u9009\u62E9\u539F\u6587");
  }
}
function AssistantOverlay({ runtime, sessionId }) {
  const { controller, state } = useController(runtime, sessionId);
  const anchor = (0, import_react.useRef)(null);
  const panelRef = (0, import_react.useRef)(null);
  const [geometry, setGeometry] = (0, import_react.useState)(null);
  const suggestion = state.suggestion;
  const panelPlacement = useFloatingPlacement(anchor, panelRef, Boolean(suggestion) && state.settings.displayMode === "panel", true);
  (0, import_react.useEffect)(() => {
    if (suggestion && (state.settings.displayMode === "panel" && panelPlacement || geometry)) controller.markExposed(suggestion.snapshot.requestId);
  }, [controller, suggestion, geometry, panelPlacement, state.settings.displayMode]);
  (0, import_react.useLayoutEffect)(() => {
    if (!suggestion || state.settings.displayMode !== "ghost") {
      setGeometry(null);
      return;
    }
    const update = () => setGeometry(measureGhost(findEditor(anchor.current), suggestion.snapshot.draft === ""));
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    document.addEventListener("selectionchange", update);
    const editor = findEditor(anchor.current);
    editor?.addEventListener("focus", update);
    editor?.addEventListener("blur", update);
    const resize = typeof ResizeObserver === "function" ? new ResizeObserver(update) : null;
    if (editor) resize?.observe(editor);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
      document.removeEventListener("selectionchange", update);
      editor?.removeEventListener("focus", update);
      editor?.removeEventListener("blur", update);
      resize?.disconnect();
    };
  }, [suggestion, state.settings.displayMode]);
  const ghostStyle = geometry ? {
    left: geometry.left,
    top: geometry.top,
    width: geometry.width,
    maxHeight: `${geometry.maxHeight}px`,
    font: geometry.font,
    lineHeight: geometry.lineHeight,
    letterSpacing: geometry.letterSpacing
  } : void 0;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("span", { ref: anchor, className: "dsh-ia", style: { display: "contents" }, children: [
    suggestion && state.settings.displayMode === "panel" && (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        ref: panelRef,
        className: "dsh-ia dsh-ia-candidate",
        role: "status",
        style: panelPlacement ?? { visibility: "hidden" },
        "data-dsh-ia-visible-suggestion": panelPlacement ? "" : void 0,
        "data-dsh-ia-session": sessionId,
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { className: "dsh-ia-candidate-text", children: suggestion.text }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", onPointerDown: (event) => event.preventDefault(), onClick: () => controller.acceptSuggestion(), children: "\u91C7\u7EB3" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("button", { type: "button", "aria-label": "\u5FFD\u7565\u5EFA\u8BAE", onClick: () => controller.dismissSuggestion(), children: "\xD7" })
        ]
      }
    ), document.body),
    suggestion && geometry && state.settings.displayMode === "ghost" && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(import_jsx_runtime.Fragment, { children: [
      suggestion.snapshot.draft === "" && /* @__PURE__ */ (0, import_jsx_runtime.jsx)("span", { hidden: true, "data-dsh-ia-empty-ghost": "" }),
      (0, import_react_dom.createPortal)(/* @__PURE__ */ (0, import_jsx_runtime.jsx)(
        "span",
        {
          className: "dsh-ia dsh-ia-ghost",
          style: ghostStyle,
          "aria-hidden": "true",
          "data-dsh-ia-visible-suggestion": "",
          "data-dsh-ia-session": sessionId,
          children: suggestion.text
        }
      ), document.body)
    ] })
  ] });
}

// src/core/types.ts
var DEFAULT_CONFIG = Object.freeze({
  optimizeEnabled: true,
  stashEnabled: true,
  optimizationStrength: "standard",
  nextEnabled: true,
  completionEnabled: true,
  predictionDetail: "standard",
  displayMode: "ghost",
  debounceMs: 600,
  minIntervalMs: 2e3,
  maxHistoryChars: 16e3,
  maxDraftChars: 8e3,
  maxNextChars: 120,
  maxCompletionChars: 80,
  optimizeTimeoutMs: 6e4,
  suggestionTimeoutMs: 15e3,
  provider: "",
  model: ""
});
var AssistantError = class extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
    this.name = "AssistantError";
  }
};

// src/core/snapshot.ts
function snapshotMatches(expected, current, checkCaret = true) {
  return expected.sessionId === current.sessionId && expected.sourceTurnId === current.sourceTurnId && expected.connectionGeneration === current.connectionGeneration && expected.routeKey === current.routeKey && expected.draftRev === current.draftRev && expected.draft === current.draft && (!checkCaret || expected.span.start === current.span.start && expected.span.end === current.span.end);
}

// src/core/context.ts
var charCount = (text) => Array.from(text).length;

// src/browser/controller.ts
var emptyMetrics = () => ({ exposures: 0, accepted: 0, editedAcceptances: 0, editedCharacters: 0, calls: 0, totalLatencyMs: 0 });
var initial = () => ({
  status: null,
  settings: { ...DEFAULT_CONFIG },
  busy: null,
  notice: "",
  suggestion: null,
  change: null,
  drafts: [],
  locked: [],
  connected: false,
  settingsSaving: false,
  metrics: emptyMetrics()
});
var InputAssistantController = class {
  constructor(sessionId, transport, metrics, saveSettings) {
    this.sessionId = sessionId;
    this.transport = transport;
    this.saveSettings = saveSettings;
    if (metrics) this.state.metrics = { ...metrics };
  }
  state = initial();
  listeners = /* @__PURE__ */ new Set();
  binding = null;
  active = null;
  timer;
  /** Cache key the armed completion timer was scheduled for; null when no timer is armed. */
  timerKey = null;
  poll;
  polling = false;
  lifecycle = new AbortController();
  disposed = false;
  composing = false;
  settingsPending = false;
  settingsEpoch = 0;
  nextTurns = /* @__PURE__ */ new Set();
  nextCache = null;
  completionCache = /* @__PURE__ */ new Map();
  failedCompletionKey = null;
  lastCompletionStart = -Infinity;
  suppressUntilEdit = null;
  sequence = 0;
  clientGeneration = null;
  lockedRanges = [];
  exposed = /* @__PURE__ */ new Set();
  acceptance = null;
  getSnapshot = () => this.state;
  subscribe = (listener) => {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  };
  patch(update) {
    if (this.disposed) return;
    this.state = { ...this.state, ...update };
    for (const listener of this.listeners) listener();
  }
  start() {
    if (this.poll || this.disposed) return;
    void this.refresh();
    void this.refreshDrafts();
    this.poll = setInterval(() => {
      void this.refresh();
    }, 900);
  }
  dispose() {
    if (this.disposed) return;
    this.cancelActive();
    this.clearTimer();
    clearInterval(this.poll);
    this.lifecycle.abort();
    this.disposed = true;
    this.listeners.clear();
    this.binding = null;
  }
  bind(binding) {
    if (this.disposed || binding.sessionId !== this.sessionId) return;
    const previous = this.binding;
    this.binding = binding;
    const generation = this.transport.generation();
    if (generation !== this.clientGeneration) {
      this.clientGeneration = generation;
      this.invalidate(true);
      this.patch({ connected: false, status: null, drafts: [] });
      if (generation !== null && this.poll) {
        void this.refresh();
        void this.refreshDrafts();
      }
    }
    const changed = previous && (previous.input.draftRev !== binding.input.draftRev || previous.input.draft !== binding.input.draft || this.routeKey(previous.route) !== this.routeKey(binding.route) || previous.running !== binding.running || previous.input.phase !== binding.input.phase || previous.input.attachmentIds.length !== binding.input.attachmentIds.length || previous.input.occurrences.length !== binding.input.occurrences.length);
    if (changed) {
      this.cancelActive();
      if (previous.input.draft !== binding.input.draft) this.observeAcceptedEdit(binding.input.draft);
      if (previous.input.draft !== binding.input.draft) this.lockedRanges = [];
      if (previous.input.draft !== binding.input.draft) this.failedCompletionKey = null;
      this.patch({ suggestion: null, ...previous.input.draft !== binding.input.draft ? { locked: [] } : {} });
      if (this.suppressUntilEdit !== null && binding.input.draft !== this.suppressUntilEdit) this.suppressUntilEdit = null;
    }
    this.driveSuggestions();
  }
  notifySelectionChange() {
    if (nativeMenuOpen(this.binding?.editor ?? null)) {
      if (this.active?.snapshot.operation !== "optimize") this.cancelActive();
      this.clearTimer();
      this.patch({ suggestion: null });
      return;
    }
    if (this.active && this.active.snapshot.operation !== "optimize" && !this.sameCaret(this.active.caret)) this.cancelActive();
    if (this.state.suggestion && !this.isCurrent(this.state.suggestion.snapshot, true)) this.patch({ suggestion: null });
    this.driveSuggestions();
  }
  setComposing(value) {
    this.composing = value;
    if (value) {
      this.cancelActive();
      this.clearTimer();
      this.patch({ suggestion: null });
    } else this.driveSuggestions();
  }
  dismissSuggestion() {
    this.clearTimer();
    this.cancelActive();
    this.patch({ suggestion: null });
    this.suppressUntilEdit = this.binding?.input.draft ?? "";
  }
  cancelOperation() {
    this.cancelActive();
    this.clearTimer();
    this.patch({ busy: null, notice: "\u5DF2\u53D6\u6D88\u672C\u6B21\u64CD\u4F5C" });
  }
  clearNotice() {
    this.patch({ notice: "" });
  }
  notice(text) {
    this.patch({ notice: text });
  }
  async refresh() {
    if (this.disposed || this.polling || this.transport.generation() === null) return;
    const generation = this.transport.generation();
    const settingsEpoch = this.settingsEpoch;
    this.polling = true;
    try {
      const status = await this.transport.call("status", { sessionId: this.sessionId }, this.lifecycle.signal);
      if (this.disposed || this.transport.generation() !== generation || settingsEpoch !== this.settingsEpoch) return;
      const previous = this.state.status;
      const changed = previous && (status.sourceTurnId !== previous.sourceTurnId || status.generation !== previous.generation || this.routeKey(status.route) !== this.routeKey(previous.route) || status.running !== previous.running || JSON.stringify(status.settings) !== JSON.stringify(previous.settings));
      if (changed) this.invalidate(true);
      this.patch({ status, settings: status.settings, connected: this.transport.generation() !== null });
      this.driveSuggestions();
    } catch {
      if (!this.disposed) {
        this.invalidate(false, false);
        this.patch({ connected: false });
      }
    } finally {
      this.polling = false;
    }
  }
  async updateSettings(update) {
    if (this.settingsPending) return;
    if (this.saveSettings) {
      try {
        await this.saveSettings(update);
        this.patch({ notice: "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58" });
      } catch (error) {
        this.patch({ notice: this.errorMessage(error) });
      }
      return;
    }
    this.beginSettingsUpdate();
    try {
      const settings = await this.transport.call("settings/set", update, this.lifecycle.signal);
      this.applySettings(settings);
      this.patch({ notice: "\u8BBE\u7F6E\u5DF2\u4FDD\u5B58" });
    } catch (error) {
      this.patch({ notice: this.errorMessage(error) });
    } finally {
      this.endSettingsUpdate();
    }
  }
  beginSettingsUpdate() {
    this.settingsEpoch++;
    this.settingsPending = true;
    this.invalidate(false);
    this.patch({ settingsSaving: true });
  }
  endSettingsUpdate() {
    this.settingsPending = false;
    this.patch({ settingsSaving: false });
    this.driveSuggestions();
  }
  /** A settings page can update every mounted composer without waiting for its status poll. */
  applySettings(settings) {
    this.settingsEpoch++;
    this.invalidate(true);
    this.patch({ settings, ...this.state.status ? { status: { ...this.state.status, settings } } : {} });
    this.driveSuggestions();
  }
  lockSelection() {
    const captured = this.captureTarget(true);
    if (!captured) return;
    if (this.state.locked.includes(captured.text)) return;
    this.lockedRanges.push({ text: captured.text, span: captured.span });
    this.patch({ locked: [...this.state.locked, captured.text], notice: "\u5DF2\u4FDD\u62A4\u9009\u4E2D\u539F\u6587\uFF1B\u7F16\u8F91\u8349\u7A3F\u540E\u9700\u91CD\u65B0\u9501\u5B9A" });
  }
  clearLocks() {
    this.lockedRanges = [];
    this.patch({ locked: [], notice: "\u5DF2\u6E05\u9664\u624B\u52A8\u4FDD\u62A4\u7247\u6BB5" });
  }
  async optimize() {
    if (this.settingsPending) return;
    if (!this.state.settings.optimizeEnabled) {
      this.patch({ notice: "\u63D0\u793A\u8BCD\u4F18\u5316\u5DF2\u5173\u95ED\uFF0C\u53EF\u5728\u8F93\u5165\u52A9\u624B\u8BBE\u7F6E\u4E2D\u542F\u7528" });
      return;
    }
    const binding = this.binding;
    if (!binding || this.state.busy) return;
    const target = this.captureTarget(false);
    if (!target || !target.text.trim()) return;
    if (this.lockedRanges.some((lock) => target.span.start < lock.span.end && target.span.end > lock.span.start && !(target.span.start <= lock.span.start && target.span.end >= lock.span.end))) {
      this.patch({ notice: "\u9009\u533A\u8DE8\u8D8A\u4E86\u53D7\u4FDD\u62A4\u7247\u6BB5\u7684\u8FB9\u754C\uFF0C\u8BF7\u5B8C\u6574\u5305\u542B\u6216\u907F\u5F00\u8BE5\u7247\u6BB5" });
      return;
    }
    if (charCount(target.text) > this.state.settings.maxDraftChars) {
      this.patch({ notice: `\u5F85\u4F18\u5316\u5185\u5BB9\u8D85\u8FC7 ${this.state.settings.maxDraftChars} \u5B57\u7B26\uFF0C\u8BF7\u9009\u62E9\u8F83\u77ED\u7247\u6BB5` });
      return;
    }
    this.clearTimer();
    this.cancelActive();
    this.patch({ suggestion: null, busy: "optimize", notice: "" });
    const snapshot = this.snapshot("optimize", target.span, target.text);
    if (!snapshot) {
      this.patch({ busy: null, notice: "\u8FDE\u63A5\u6216\u6A21\u578B\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5" });
      return;
    }
    const active = this.begin(snapshot);
    try {
      const result = await this.transport.call("generate", snapshot, active.controller.signal);
      if (this.active !== active || !this.isCurrent(snapshot, false) || !this.validResult(result, snapshot)) return;
      if (result.text === null || !result.text.trim()) {
        this.patch({ notice: "\u6CA1\u6709\u53EF\u5E94\u7528\u7684\u4F18\u5316\u7ED3\u679C\uFF0C\u539F\u6587\u5DF2\u4FDD\u7559" });
        return;
      }
      const after = binding.input.draft.slice(0, target.clipboardStart) + result.text + binding.input.draft.slice(target.clipboardEnd);
      if (!binding.actions.insertText(result.text, target.span)) {
        this.patch({ notice: "\u8349\u7A3F\u5DF2\u53D8\u5316\uFF0C\u5DF2\u653E\u5F03\u672C\u6B21\u7ED3\u679C" });
        return;
      }
      binding.actions.persistDraft?.();
      this.suppressUntilEdit = after;
      this.patch({ change: {
        before: binding.input.draft,
        after,
        beforeTarget: target.text,
        afterTarget: result.text,
        span: { ...target.span, end: target.span.start + result.text.length },
        sourceTurnId: snapshot.sourceTurnId,
        connectionGeneration: snapshot.connectionGeneration,
        routeKey: snapshot.routeKey,
        clientGeneration: active.clientGeneration
      }, notice: "\u5DF2\u4F18\u5316\uFF0C\u53EF\u67E5\u770B\u6539\u52A8\u6216\u64A4\u9500" });
    } catch (error) {
      if (!active.controller.signal.aborted) this.patch({ notice: this.errorMessage(error) });
    } finally {
      this.recordLatency(active);
      if (this.active === active) {
        this.active = null;
        this.patch({ busy: null });
      }
    }
  }
  canRestore() {
    const change = this.state.change, binding = this.binding, status = this.state.status;
    return Boolean(change && binding && status && this.state.connected && binding.input.draft === change.after && binding.input.phase === "plain" && status.sourceTurnId === change.sourceTurnId && status.generation === change.connectionGeneration && this.routeKey(binding.route ?? status.route) === change.routeKey && this.transport.generation() === change.clientGeneration);
  }
  restoreOriginal() {
    const binding = this.binding, change = this.state.change;
    if (!binding || !change || !this.canRestore()) {
      this.patch({ notice: "\u8349\u7A3F\u5DF2\u6709\u65B0\u7F16\u8F91\uFF0C\u53EF\u5728\u6539\u52A8\u9762\u677F\u590D\u5236\u539F\u6587" });
      return false;
    }
    this.cancelActive();
    const applied = binding.actions.insertText(change.beforeTarget, { ...change.span, draftRev: binding.input.draftRev });
    if (applied) {
      binding.actions.persistDraft?.();
      this.suppressUntilEdit = change.before;
      this.patch({ change: null, suggestion: null, notice: "\u5DF2\u8FD8\u539F\u4F18\u5316\u524D\u7684\u5185\u5BB9" });
    }
    return applied;
  }
  async triggerSuggestion() {
    const binding = this.binding;
    if (!binding) return;
    if (!this.pureText()) {
      this.patch({ notice: "\u9884\u6D4B\u4EC5\u652F\u6301\u65E0\u5F15\u7528\u3001\u65E0\u9644\u4EF6\u7684\u7EAF\u6587\u672C\u8349\u7A3F" });
      return;
    }
    this.suppressUntilEdit = null;
    this.failedCompletionKey = null;
    const operation = binding.input.draft === "" ? "next" : "complete";
    const span = binding.actions.captureInsertion(), snapshot = this.snapshot(operation, span);
    if (!snapshot || span.start !== span.end || span.end !== binding.input.draft.length) return;
    snapshot.manual = true;
    if (operation === "complete") this.lastCompletionStart = Date.now();
    const active = this.begin(snapshot);
    this.patch({ busy: "optimize", notice: "" });
    try {
      const result = await this.transport.call("generate", snapshot, active.controller.signal);
      if (this.active !== active || !this.isCurrent(snapshot, false) || !this.validResult(result, snapshot)) return;
      if (!result.text || !result.text.trim()) {
        this.patch({ notice: "\u672C\u6B21\u6682\u65E0\u5408\u9002\u9884\u6D4B\uFF0C\u5DF2\u4FDD\u7559\u539F\u7A3F" });
        return;
      }
      const before = binding.input.draft;
      const after = operation === "complete" ? before + result.text : result.text;
      const applied = binding.actions.insertText(result.text, span);
      if (!applied) {
        this.patch({ notice: "\u8349\u7A3F\u5DF2\u53D8\u5316\uFF0C\u5DF2\u653E\u5F03\u672C\u6B21\u7ED3\u679C" });
        return;
      }
      binding.actions.persistDraft?.();
      this.suppressUntilEdit = after;
      this.patch({
        change: {
          before,
          after,
          beforeTarget: operation === "complete" ? "" : before,
          afterTarget: result.text,
          span: { ...span, end: span.start + result.text.length },
          sourceTurnId: snapshot.sourceTurnId,
          connectionGeneration: snapshot.connectionGeneration,
          routeKey: snapshot.routeKey,
          clientGeneration: active.clientGeneration
        },
        suggestion: null,
        notice: "\u5DF2\u586B\u5165\u9884\u6D4B\uFF0C\u53EF\u67E5\u770B\u6539\u52A8\u6216\u8FD8\u539F"
      });
    } catch (error) {
      if (!active.controller.signal.aborted) this.patch({ notice: this.errorMessage(error) });
    } finally {
      this.recordLatency(active);
      if (this.active === active) {
        this.active = null;
        this.patch({ busy: null });
      }
    }
  }
  acceptSuggestion() {
    const suggestion = this.state.suggestion, binding = this.binding;
    if (!suggestion || !binding || !this.isCurrent(suggestion.snapshot, true) || !this.eligible() || (suggestion.kind === "next" ? !this.state.settings.nextEnabled : !this.state.settings.completionEnabled)) {
      this.patch({ suggestion: null });
      return false;
    }
    const applied = binding.actions.insertText(suggestion.text, suggestion.snapshot.span);
    this.patch({ suggestion: null });
    if (applied) {
      binding.actions.persistDraft?.();
      this.suppressUntilEdit = binding.input.draft + suggestion.text;
      this.acceptance = { expected: this.suppressUntilEdit, edits: 0, counted: false };
      this.patch({ metrics: { ...this.state.metrics, accepted: this.state.metrics.accepted + 1 } });
    }
    return applied;
  }
  /** Called only after the overlay has actually rendered a candidate. */
  markExposed(requestId) {
    const suggestion = this.state.suggestion;
    if (!suggestion || suggestion.snapshot.requestId !== requestId) return;
    const key = JSON.stringify([suggestion.snapshot.sourceTurnId, suggestion.snapshot.routeKey, suggestion.snapshot.draft, suggestion.text, suggestion.kind]);
    if (this.exposed.has(key)) return;
    if (this.exposed.size >= 512) this.exposed.clear();
    this.exposed.add(key);
    this.patch({ metrics: { ...this.state.metrics, exposures: this.state.metrics.exposures + 1 } });
  }
  async refreshDrafts() {
    const generation = this.transport.generation();
    if (generation === null) return;
    try {
      const drafts = await this.transport.call("drafts/list", { sessionId: this.sessionId }, this.lifecycle.signal);
      if (generation === this.transport.generation()) this.patch({ drafts });
    } catch (error) {
      if (!this.lifecycle.signal.aborted) this.patch({ notice: this.errorMessage(error) });
    }
  }
  async stash(replaceId) {
    if (this.settingsPending) return;
    if (!this.state.settings.stashEnabled) {
      this.patch({ notice: "\u8349\u7A3F\u6682\u5B58\u5DF2\u5173\u95ED\uFF0C\u5DF2\u4FDD\u5B58\u7684\u8349\u7A3F\u4ECD\u53EF\u67E5\u770B\u548C\u5220\u9664" });
      return;
    }
    const binding = this.binding;
    if (!binding || this.state.busy) return;
    if (!this.pureText() || !binding.input.draft.trim()) {
      this.patch({ notice: "\u6682\u5B58\u4EC5\u652F\u6301\u65E0\u5F15\u7528\u3001\u65E0\u9644\u4EF6\u7684\u975E\u7A7A\u7EAF\u6587\u672C\u8349\u7A3F" });
      return;
    }
    if (this.state.drafts.length >= 3 && !replaceId) {
      this.patch({ notice: "\u5DF2\u6682\u5B58\u4E09\u6761\uFF0C\u8BF7\u5220\u9664\u4E00\u6761\u6216\u9009\u62E9\u66FF\u6362" });
      return;
    }
    const original = binding.input.draft, rev = binding.input.draftRev, clientGeneration = this.transport.generation();
    this.cancelActive();
    this.clearTimer();
    this.patch({ busy: "stash", suggestion: null, notice: "" });
    try {
      await this.transport.call("drafts/save", { sessionId: this.sessionId, text: original, ...replaceId ? { replaceId } : {} }, this.lifecycle.signal);
      await this.refreshDrafts();
      const live = this.binding;
      if (!this.settingsPending && this.state.settings.stashEnabled && live?.input.draftRev === rev && live.input.draft === original && live.input.phase === "plain" && clientGeneration === this.transport.generation() && this.pureText()) {
        if (live.actions.insertText("", { start: 0, end: original.length, draftRev: rev })) {
          live.actions.persistDraft?.();
          this.suppressUntilEdit = "";
          this.patch({ notice: "\u8349\u7A3F\u5DF2\u6682\u5B58\u5E76\u6E05\u7A7A\uFF1B\u53EF\u64A4\u9500\u6E05\u7A7A" });
          return;
        }
      }
      this.patch({ notice: "\u5DF2\u4FDD\u5B58\u5FEB\u7167\uFF1B\u5F53\u524D\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u4FDD\u7559\u5F53\u524D\u8F93\u5165" });
    } catch (error) {
      this.patch({ notice: this.errorMessage(error) });
    } finally {
      this.patch({ busy: null });
    }
  }
  restoreDraft(draft, mode) {
    if (this.settingsPending) return false;
    const binding = this.binding;
    if (!this.state.settings.stashEnabled) {
      this.patch({ notice: "\u8349\u7A3F\u6682\u5B58\u5DF2\u5173\u95ED\uFF0C\u8BF7\u91CD\u65B0\u542F\u7528\u540E\u6062\u590D" });
      return false;
    }
    if (!this.state.connected || !this.state.status) {
      this.patch({ notice: "\u8FDE\u63A5\u5C1A\u672A\u5C31\u7EEA\uFF0C\u5DF2\u4FDD\u7559\u5F53\u524D\u8F93\u5165" });
      return false;
    }
    if (!binding || !this.pureText()) {
      this.patch({ notice: "\u8BF7\u5148\u79FB\u9664\u5F15\u7528\u548C\u9644\u4EF6\uFF0C\u518D\u6062\u590D\u7EAF\u6587\u672C\u8349\u7A3F" });
      return false;
    }
    this.cancelActive();
    this.clearTimer();
    const span = { start: mode === "replace" ? 0 : binding.input.draft.length, end: binding.input.draft.length, draftRev: binding.input.draftRev };
    const text = mode === "append" && binding.input.draft ? `
${draft.text}` : draft.text;
    const applied = binding.actions.insertText(text, span);
    if (applied) {
      binding.actions.persistDraft?.();
      this.suppressUntilEdit = mode === "replace" ? text : binding.input.draft + text;
      this.patch({ suggestion: null, notice: "\u8349\u7A3F\u5DF2\u6062\u590D\uFF0C\u5C1A\u672A\u53D1\u9001" });
    }
    return applied;
  }
  async deleteDraft(id) {
    await this.mutateDraft("drafts/delete", { sessionId: this.sessionId, id });
  }
  async clearDrafts() {
    await this.mutateDraft("drafts/clear", { sessionId: this.sessionId });
  }
  async mutateDraft(method, data) {
    try {
      await this.transport.call(method, data, this.lifecycle.signal);
      await this.refreshDrafts();
    } catch (error) {
      this.patch({ notice: this.errorMessage(error) });
    }
  }
  captureTarget(requireSelection) {
    const binding = this.binding;
    if (!binding || binding.input.phase !== "plain") {
      this.patch({ notice: "\u5F53\u524D\u8F93\u5165\u6846\u6682\u65F6\u4E0D\u53EF\u7F16\u8F91" });
      return null;
    }
    const span = binding.actions.captureInsertion();
    if (span.start !== span.end) {
      const selected = selectedPlainText(binding.editor, binding.input.draft, span, binding.input.occurrences);
      if (!selected) {
        this.patch({ notice: "\u8BF7\u9009\u62E9\u5B8C\u5168\u4F4D\u4E8E\u666E\u901A\u6587\u5B57\u4E2D\u7684\u7247\u6BB5\uFF0C\u907F\u514D\u8DE8\u8D8A\u5F15\u7528\u6807\u7B7E" });
        return null;
      }
      return { ...selected, span };
    }
    if (requireSelection) {
      this.patch({ notice: "\u8BF7\u5148\u5728\u8F93\u5165\u6846\u9009\u4E2D\u8981\u4FDD\u62A4\u7684\u6587\u5B57" });
      return null;
    }
    if (binding.input.occurrences.length) {
      this.patch({ notice: "\u542B\u5F15\u7528\u6807\u7B7E\u65F6\uFF0C\u8BF7\u9009\u62E9\u4E0D\u8DE8\u6807\u7B7E\u7684\u7EAF\u6587\u5B57\u7247\u6BB5\u4F18\u5316" });
      return null;
    }
    return { text: binding.input.draft, span: { start: 0, end: binding.input.draft.length, draftRev: binding.input.draftRev }, clipboardStart: 0, clipboardEnd: binding.input.draft.length };
  }
  pureText() {
    const input = this.binding?.input;
    return Boolean(input && input.phase === "plain" && !input.occurrences.length && !input.attachmentIds.length);
  }
  eligible() {
    return this.pureText() && !this.composing && !this.settingsPending && !this.binding?.running && !this.state.status?.running && !this.state.busy && this.state.connected && this.suppressUntilEdit === null;
  }
  driveSuggestions() {
    const binding = this.binding, status = this.state.status;
    if (!binding || !status || !this.eligible() || this.active) {
      this.clearTimer();
      return;
    }
    if (nativeMenuOpen(binding.editor)) {
      this.clearTimer();
      return;
    }
    const span = binding.actions.captureInsertion();
    if (span.start !== span.end || span.end !== binding.input.draft.length || !focusedIn(binding.editor)) {
      this.clearTimer();
      return;
    }
    const turn = status.sourceTurnId;
    const route = this.routeKey(binding.route ?? status.route);
    if (binding.input.draft === "") {
      this.clearTimer();
      if (!turn) return;
      if (!this.state.settings.nextEnabled || this.nextTurns.has(`${status.generation}:${turn}:${route}`)) return;
      if (this.nextTurns.size >= 512) this.nextTurns.clear();
      this.nextTurns.add(`${status.generation}:${turn}:${route}`);
      void this.requestSuggestion("next");
      return;
    }
    if (!this.state.settings.completionEnabled || charCount(binding.input.draft) > this.state.settings.maxDraftChars) {
      this.clearTimer();
      return;
    }
    if (this.nextCache && this.nextCache.turn === turn && this.nextCache.route === route && this.nextCache.generation === status.generation && this.nextCache.text.startsWith(binding.input.draft)) {
      this.clearTimer();
      const suffix = this.nextCache.text.slice(binding.input.draft.length);
      const snapshot = this.snapshot("complete", span);
      if (suffix && charCount(suffix) <= this.state.settings.maxCompletionChars && snapshot) this.patch({ suggestion: { text: suffix, snapshot, kind: "complete" } });
      return;
    }
    const cacheKey = this.completionKey();
    if (cacheKey === this.failedCompletionKey) {
      this.clearTimer();
      return;
    }
    if (this.completionCache.has(cacheKey)) {
      this.clearTimer();
      const text = this.completionCache.get(cacheKey), snapshot = this.snapshot("complete", span);
      if (text && snapshot) this.patch({ suggestion: { text, snapshot, kind: "complete" } });
      return;
    }
    if (this.timer !== void 0 && this.timerKey === cacheKey) return;
    this.clearTimer();
    const delay = Math.max(this.state.settings.debounceMs, this.lastCompletionStart + this.state.settings.minIntervalMs - Date.now());
    this.timerKey = cacheKey;
    this.timer = setTimeout(() => {
      this.timer = void 0;
      this.timerKey = null;
      void this.requestSuggestion("complete");
    }, delay);
  }
  async requestSuggestion(operation, manual = false) {
    const binding = this.binding;
    if (!binding || !manual && !this.eligible()) return;
    const span = binding.actions.captureInsertion(), snapshot = this.snapshot(operation, span);
    if (!snapshot || span.start !== span.end || span.end !== binding.input.draft.length) return;
    snapshot.manual = manual;
    if (operation === "complete") this.lastCompletionStart = Date.now();
    const active = this.begin(snapshot), cacheKey = this.completionKey();
    if (manual) this.patch({ notice: "\u6B63\u5728\u9884\u6D4B\u751F\u6210\u4E2D\u2026" });
    try {
      const result = await this.transport.call("generate", snapshot, active.controller.signal);
      if (this.active !== active || !this.isCurrent(snapshot, true)) return;
      if (!this.validResult(result, snapshot)) {
        if (operation === "complete") this.failedCompletionKey = cacheKey;
        if (manual) this.patch({ notice: "\u672C\u6B21\u6682\u65E0\u5408\u9002\u5EFA\u8BAE" });
        return;
      }
      if (operation === "complete") {
        this.completionCache.set(cacheKey, result.text);
        if (this.completionCache.size > 64) this.completionCache.delete(this.completionCache.keys().next().value);
      }
      if (operation === "next" && result.text) this.nextCache = { text: result.text, turn: snapshot.sourceTurnId, route: snapshot.routeKey, generation: snapshot.connectionGeneration };
      if (result.text) {
        this.patch({ suggestion: { text: result.text, snapshot, kind: operation }, notice: "" });
      } else if (manual) {
        this.patch({ notice: "\u672C\u6B21\u6682\u65E0\u5408\u9002\u5EFA\u8BAE" });
      }
    } catch (error) {
      if (manual) this.patch({ notice: this.errorMessage(error) });
      if (operation === "complete" && !active.controller.signal.aborted && this.active === active && this.isCurrent(snapshot, false)) {
        this.failedCompletionKey = cacheKey;
      }
    } finally {
      this.recordLatency(active);
      if (this.active === active) this.active = null;
    }
  }
  snapshot(operation, span, targetText) {
    const binding = this.binding, status = this.state.status;
    if (!binding || !status || !this.state.connected) return null;
    const route = binding.route ?? status.route;
    return {
      operation,
      sessionId: this.sessionId,
      requestId: `${Date.now().toString(36)}-${++this.sequence}`,
      sourceTurnId: status.sourceTurnId,
      draft: binding.input.draft,
      draftRev: binding.input.draftRev,
      span: { ...span },
      connectionGeneration: status.generation,
      routeKey: this.routeKey(route),
      ...targetText === void 0 ? {} : { targetText },
      ...this.state.locked.length ? { lockedFragments: this.state.locked.filter((text) => (targetText ?? binding.input.draft).includes(text)) } : {},
      ...route ? { provider: route.provider, model: route.model } : {}
    };
  }
  begin(snapshot) {
    this.cancelActive();
    const active = {
      snapshot,
      controller: new AbortController(),
      clientGeneration: this.transport.generation(),
      caret: this.binding.actions.captureInsertion(),
      startedAt: Date.now(),
      latencyRecorded: false
    };
    this.active = active;
    this.patch({ metrics: { ...this.state.metrics, calls: this.state.metrics.calls + 1 } });
    return active;
  }
  observeAcceptedEdit(draft) {
    const acceptance = this.acceptance;
    if (!acceptance) return;
    if (!draft) {
      this.acceptance = null;
      return;
    }
    if (draft === acceptance.expected && !acceptance.counted) return;
    let start = 0, end = 0;
    while (start < draft.length && start < acceptance.expected.length && draft[start] === acceptance.expected[start]) start++;
    while (end < draft.length - start && end < acceptance.expected.length - start && draft[draft.length - end - 1] === acceptance.expected[acceptance.expected.length - end - 1]) end++;
    const edits = draft.length + acceptance.expected.length - 2 * start - 2 * end;
    this.patch({ metrics: {
      ...this.state.metrics,
      editedAcceptances: this.state.metrics.editedAcceptances + (acceptance.counted ? 0 : 1),
      editedCharacters: this.state.metrics.editedCharacters + edits - acceptance.edits
    } });
    acceptance.counted = true;
    acceptance.edits = edits;
  }
  isCurrent(snapshot, checkCaret) {
    const binding = this.binding, status = this.state.status;
    return Boolean(binding && status && !this.disposed && this.transport.generation() === this.clientGeneration && this.transport.generation() !== null && binding.sessionId === snapshot.sessionId && binding.input.phase === "plain" && snapshotMatches(snapshot, {
      sessionId: binding.sessionId,
      sourceTurnId: status.sourceTurnId,
      draft: binding.input.draft,
      draftRev: binding.input.draftRev,
      span: binding.actions.captureInsertion(),
      connectionGeneration: status.generation,
      routeKey: this.routeKey(binding.route ?? status.route)
    }, checkCaret));
  }
  validResult(result, request) {
    return result.requestId === request.requestId && result.sessionId === request.sessionId && result.sourceTurnId === request.sourceTurnId && result.draftRev === request.draftRev && result.connectionGeneration === request.connectionGeneration && result.routeKey === request.routeKey && result.span.start === request.span.start && result.span.end === request.span.end && (result.text === null || typeof result.text === "string");
  }
  sameCaret(span) {
    const current = this.binding?.actions.captureInsertion();
    return Boolean(current && current.start === span.start && current.end === span.end && current.draftRev === span.draftRev);
  }
  routeKey(route) {
    return route ? JSON.stringify([route.provider, route.model]) : "";
  }
  completionKey() {
    return JSON.stringify([this.state.status?.generation, this.state.status?.sourceTurnId, this.routeKey(this.binding?.route ?? this.state.status?.route), this.binding?.input.draft]);
  }
  invalidate(dropCache, cancelInFlight = true) {
    if (cancelInFlight) this.cancelActive();
    else if (this.active?.snapshot.operation !== "optimize") this.cancelActive();
    this.clearTimer();
    if (dropCache) {
      this.nextCache = null;
      this.completionCache.clear();
      this.failedCompletionKey = null;
    }
    this.patch({ suggestion: null });
  }
  clearTimer() {
    clearTimeout(this.timer);
    this.timer = void 0;
    this.timerKey = null;
  }
  cancelActive() {
    const active = this.active;
    if (!active) return;
    this.active = null;
    this.recordLatency(active);
    active.controller.abort();
    void this.transport.call("cancel", { sessionId: this.sessionId, requestId: active.snapshot.requestId }).catch(() => {
    });
    if (active.snapshot.operation === "optimize") this.patch({ busy: null });
  }
  recordLatency(active) {
    if (active.latencyRecorded) return;
    active.latencyRecorded = true;
    this.patch({ metrics: { ...this.state.metrics, totalLatencyMs: this.state.metrics.totalLatencyMs + Math.max(0, Date.now() - active.startedAt) } });
  }
  errorMessage(error) {
    return error instanceof Error ? error.message : "\u64CD\u4F5C\u5931\u8D25\uFF0C\u539F\u7A3F\u5DF2\u4FDD\u7559\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5";
  }
};

// src/browser/runtime.ts
var BrowserRuntime = class {
  constructor(connection, models) {
    this.connection = connection;
    this.models = models;
    this.transport = {
      generation: () => {
        const generation = connection.generation.getSnapshot();
        return generation ? String(generation.id) : null;
      },
      call: async (method, data, signal) => {
        const result = await connection.rpc.call("/api", "input-assistant/call", { args: { payload: { method, data } } }, signal);
        if (!result.ok) throw new Error(result.error.message || `\u8F93\u5165\u52A9\u624B\u8BF7\u6C42\u5931\u8D25 (${result.error.code || "unknown"})`);
        return result.value;
      }
    };
  }
  entries = /* @__PURE__ */ new Map();
  disposed = false;
  lifetime = new AbortController();
  pendingSettings = 0;
  settingsQueue = Promise.resolve();
  metrics = /* @__PURE__ */ new Map();
  transport;
  controllerFor(sessionId) {
    let entry = this.entries.get(sessionId);
    if (!entry) {
      entry = { controller: new InputAssistantController(sessionId, this.transport, this.metrics.get(sessionId), (update) => this.saveSettings(update)), refs: 0 };
      this.entries.set(sessionId, entry);
      if (this.pendingSettings) entry.controller.beginSettingsUpdate();
    }
    return entry.controller;
  }
  retain(sessionId) {
    const controller = this.controllerFor(sessionId), entry = this.entries.get(sessionId);
    entry.refs++;
    controller.start();
    return () => {
      entry.refs--;
      queueMicrotask(() => {
        if (entry.refs === 0 && this.entries.get(sessionId) === entry) {
          this.metrics.set(sessionId, { ...controller.getSnapshot().metrics });
          controller.dispose();
          this.entries.delete(sessionId);
        }
      });
    };
  }
  applySettings(settings) {
    for (const entry of this.entries.values()) entry.controller.applySettings(settings);
  }
  async saveSettings(update) {
    if (this.disposed) throw new Error("\u8F93\u5165\u52A9\u624B\u5DF2\u5378\u8F7D");
    const generation = this.transport.generation();
    if (generation === null) throw new Error("\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u8BF7\u91CD\u8FDE\u540E\u4FDD\u5B58");
    if (this.pendingSettings++ === 0) for (const entry of this.entries.values()) entry.controller.beginSettingsUpdate();
    const task = this.settingsQueue.then(async () => {
      if (this.disposed) throw new Error("\u8F93\u5165\u52A9\u624B\u5DF2\u5378\u8F7D");
      if (generation !== this.transport.generation()) throw new Error("\u8FDE\u63A5\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u8BBE\u7F6E");
      const settings = await this.transport.call("settings/set", update, this.lifetime.signal);
      if (this.disposed || generation !== this.transport.generation()) throw new Error("\u8FDE\u63A5\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u8BBE\u7F6E");
      this.applySettings(settings);
      return settings;
    });
    this.settingsQueue = task.then(() => {
    }, () => {
    });
    try {
      return await task;
    } finally {
      if (--this.pendingSettings === 0) for (const entry of this.entries.values()) entry.controller.endSettingsUpdate();
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.lifetime.abort();
    for (const entry of this.entries.values()) entry.controller.dispose();
    this.entries.clear();
    this.metrics.clear();
  }
};

// src/browser/styles.ts
var STYLE_TEXT = `
.dsh-ia {
  --dsh-ia-fallback-bg: #ffffff;
  --dsh-ia-fallback-fg: #111827;
  --dsh-ia-fallback-muted: #4b5563;
  --dsh-ia-fallback-border: #d1d5db;
  --dsh-ia-accent: var(--dsw-alias-state-business-primary, #3b82f6);
  --dsh-ia-accent-subtle: rgba(59, 130, 246, 0.1);
  --dsh-ia-pill-bg: var(--dsw-alias-interactive-bg-subtle, rgba(0, 0, 0, 0.04));
  --dsh-ia-pill-hover: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
  font-family: var(--dsw-font-family, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif);
  color: var(--dsw-alias-label-primary, var(--dsh-ia-fallback-fg));
  font-size: 13px;
  line-height: 1.5;
  box-sizing: border-box;
  color-scheme: light;
}

body[data-ds-dark-theme] .dsh-ia {
  --dsh-ia-fallback-bg: #1f2329;
  --dsh-ia-fallback-fg: #f3f4f6;
  --dsh-ia-fallback-muted: #9ca3af;
  --dsh-ia-fallback-border: #374151;
  --dsh-ia-pill-bg: var(--dsw-alias-interactive-bg-subtle, rgba(255, 255, 255, 0.06));
  --dsh-ia-pill-hover: var(--dsw-alias-interactive-bg-hover, rgba(255, 255, 255, 0.12));
  color-scheme: dark;
}

.dsh-ia * { box-sizing: border-box; }
.dsh-ia button, .dsh-ia input, .dsh-ia select { font: inherit; color: inherit; }

/* Global buttons within dsh-ia */
.dsh-ia button {
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 7px;
  padding: 5px 11px;
  background: var(--dsw-alias-bg-layer-1, transparent);
  color: var(--dsw-alias-label-primary, inherit);
  cursor: pointer;
  transition: all 0.15s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 5px;
}
.dsh-ia button:hover:not(:disabled) {
  background: var(--dsw-alias-interactive-bg-hover, #8882);
  border-color: var(--dsw-alias-state-business-primary, var(--dsh-ia-accent));
}
.dsh-ia button:active:not(:disabled) {
  transform: translateY(1px);
}
.dsh-ia button:disabled {
  opacity: 0.45;
  cursor: default;
  transform: none;
}
.dsh-ia button:focus-visible, .dsh-ia input:focus-visible, .dsh-ia select:focus-visible {
  outline: 2px solid var(--dsw-alias-state-business-primary, #3b82f6);
  outline-offset: 2px;
}

/* Smart Pill Trigger Group in Input Card */
.dsh-ia-root {
  display: inline-flex;
  align-items: center;
  background: var(--dsh-ia-pill-bg);
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 8px;
  padding: 2px;
  gap: 2px;
  position: relative;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.04);
}
.dsh-ia-root .dsh-ia-trigger {
  border: none;
  background: transparent;
  padding: 4px 10px;
  font-weight: 500;
  border-radius: 6px;
  white-space: nowrap;
}
.dsh-ia-root .dsh-ia-trigger:hover:not(:disabled) {
  background: var(--dsh-ia-pill-hover);
}
.dsh-ia-root .dsh-ia-menu-btn {
  border: none;
  background: transparent;
  padding: 4px 6px;
  border-radius: 6px;
  min-width: 24px;
}
.dsh-ia-root .dsh-ia-menu-btn:hover:not(:disabled) {
  background: var(--dsh-ia-pill-hover);
}
.dsh-ia-root .dsh-ia-cancel-btn {
  border: none;
  background: rgba(239, 68, 68, 0.12);
  color: #ef4444;
  font-size: 11px;
  padding: 4px 8px;
  border-radius: 6px;
}
.dsh-ia-root .dsh-ia-cancel-btn:hover {
  background: rgba(239, 68, 68, 0.2);
}

/* Floating Menu Panel */
.dsh-ia-menu {
  position: fixed;
  width: min(480px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: 16px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 14px;
  background: var(--dsw-alias-bg-layer-2, var(--dsh-ia-fallback-bg));
  box-shadow: 0 12px 36px rgba(0, 0, 0, 0.22);
  z-index: 1000;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.dsh-ia-preview {
  z-index: 1001;
  width: min(580px, calc(100vw - 24px));
}
.dsh-ia-preview .dsh-ia-pre {
  margin-top: 10px;
  max-height: 360px;
}

/* Tab Bar Navigation */
.dsh-ia-tabs {
  display: flex;
  background: var(--dsh-ia-pill-bg);
  border-radius: 8px;
  padding: 3px;
  gap: 3px;
  margin-bottom: 4px;
}
.dsh-ia-tab-item {
  flex: 1;
  border: none !important;
  background: transparent !important;
  padding: 6px 8px !important;
  font-size: 12px !important;
  font-weight: 500;
  border-radius: 6px !important;
  color: var(--dsw-alias-label-secondary, var(--dsh-ia-fallback-muted)) !important;
  cursor: pointer;
  box-shadow: none !important;
}
.dsh-ia-tab-item.active {
  background: var(--dsw-alias-bg-layer-1, var(--dsh-ia-fallback-bg)) !important;
  color: var(--dsw-alias-label-primary, inherit) !important;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.1) !important;
}

/* Menu Header */
.dsh-ia-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}
.dsh-ia-header h3 {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  display: flex;
  align-items: center;
  gap: 6px;
}

/* Form Controls & Fields */
.dsh-ia-row {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-wrap: wrap;
  margin: 6px 0;
}
.dsh-ia-row label {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  cursor: pointer;
  user-select: none;
}
.dsh-ia-field {
  display: flex;
  flex-direction: column;
  gap: 5px;
  margin: 6px 0;
}
.dsh-ia-field input, .dsh-ia select {
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 7px;
  background: var(--dsw-alias-bg-layer-1, var(--dsh-ia-fallback-bg));
  padding: 7px 10px;
  color: var(--dsw-alias-label-primary, inherit);
  transition: border-color 0.15s ease;
}
.dsh-ia-field input:focus, .dsh-ia select:focus {
  border-color: var(--dsw-alias-state-business-primary, var(--dsh-ia-accent));
}
.dsh-ia-field input { width: 100%; }
.dsh-ia-muted {
  color: var(--dsw-alias-label-secondary, var(--dsh-ia-fallback-muted));
  font-size: 12px;
  line-height: 1.45;
}

/* Sections */
.dsh-ia-section {
  border-top: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  margin-top: 8px;
  padding-top: 10px;
}
.dsh-ia-section h4 {
  font-size: 13px;
  margin: 0 0 8px;
  font-weight: 600;
}

/* Notices & Alerts */
.dsh-ia-notice {
  position: fixed;
  max-width: min(360px, calc(100vw - 32px));
  overflow: auto;
  padding: 6px 12px;
  background: var(--dsw-alias-bg-layer-2, var(--dsh-ia-fallback-bg));
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 20px;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  z-index: 1002;
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  animation: dshIaFadeIn 0.2s ease-out;
  cursor: pointer;
}
@keyframes dshIaFadeIn {
  from { opacity: 0; transform: translateY(4px); }
  to { opacity: 1; transform: translateY(0); }
}
.dsh-ia-menu .dsh-ia-notice {
  position: static;
  max-width: 100%;
  margin: 6px 0;
  box-shadow: none;
}
.dsh-ia-notice button { margin-left: 6px; padding: 3px 8px; font-size: 11px; }

/* Diff / Pre formatting */
.dsh-ia-pre {
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font: inherit;
  font-size: 12px;
  max-height: 200px;
  overflow-y: auto;
  padding: 10px;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 8px;
  background: var(--dsw-alias-bg-module-platform, rgba(128, 128, 128, 0.08));
}
.dsh-ia-diff ins {
  background: rgba(39, 163, 91, 0.22);
  color: #107c41;
  text-decoration: none;
  border-radius: 2px;
  padding: 0 2px;
}
body[data-ds-dark-theme] .dsh-ia-diff ins {
  color: #4ade80;
  background: rgba(34, 197, 94, 0.22);
}
.dsh-ia-diff del {
  background: rgba(217, 69, 69, 0.22);
  color: #c42b1c;
  text-decoration: line-through;
  border-radius: 2px;
  padding: 0 2px;
}
body[data-ds-dark-theme] .dsh-ia-diff del {
  color: #f87171;
  background: rgba(239, 68, 68, 0.22);
}

/* Draft Card */
.dsh-ia-draft {
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 9px;
  padding: 9px 12px;
  margin: 8px 0;
  background: var(--dsw-alias-bg-layer-1, transparent);
  transition: border-color 0.15s ease;
}
.dsh-ia-draft summary {
  cursor: pointer;
  overflow-wrap: anywhere;
  font-weight: 500;
  outline: none;
}
.dsh-ia-draft time {
  display: block;
  font-size: 11px;
  color: var(--dsw-alias-label-tertiary, var(--dsh-ia-fallback-muted));
  margin: 3px 0 6px;
}

/* Candidate Panel & Ghost Text */
.dsh-ia-candidate {
  position: fixed;
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 10px 14px;
  max-width: min(640px, calc(100vw - 32px));
  max-height: 240px;
  overflow-y: auto;
  border: 1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border));
  border-radius: 11px;
  background: var(--dsw-alias-bg-layer-2, var(--dsh-ia-fallback-bg));
  box-shadow: 0 6px 24px rgba(0, 0, 0, 0.2);
  pointer-events: auto;
  z-index: 998;
}
.dsh-ia-candidate-text {
  flex: 1;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  font-size: 13px;
  line-height: 1.5;
}
.dsh-ia-ghost {
  position: fixed;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: break-word;
  overflow: hidden;
  max-height: 100%;
  pointer-events: none;
  user-select: none;
  color: var(--dsw-alias-label-tertiary, #76808d);
  opacity: 0.88;
  z-index: 34;
}
[data-composer-card]:has([data-dsh-ia-empty-ghost]) [data-composer-placeholder] {
  visibility: hidden;
}

/* Settings Form page */
.dsh-ia-settings { width: 100%; max-width: 760px; }
.dsh-ia-settings h2 { font-size: 18px; margin: 0 0 8px; }
.dsh-ia-settings h3 { font-size: 14px; margin: 0 0 10px; font-weight: 600; }
.dsh-ia-settings fieldset { padding: 0; margin: 0; border: 0; min-width: 0; }
.dsh-ia-settings-toggles { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
.dsh-ia-settings-toggles label { display: flex; align-items: center; gap: 7px; cursor: pointer; }
.dsh-ia-sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
  border: 0;
}
`;

// src/browser/settings.tsx
var import_react2 = require("react");

// src/core/config.ts
var numeric = {
  debounceMs: [200, 5e3],
  minIntervalMs: [500, 3e4],
  maxHistoryChars: [1e3, 64e3],
  maxDraftChars: [100, 32e3],
  maxNextChars: [20, 1e3],
  maxCompletionChars: [10, 500],
  optimizeTimeoutMs: [1e3, 12e4],
  suggestionTimeoutMs: [1e3, 6e4]
};
var booleans = ["optimizeEnabled", "stashEnabled", "nextEnabled", "completionEnabled"];
var strings = ["provider", "model"];
function validate(config) {
  for (const key of booleans) {
    if (typeof config[key] !== "boolean") throw new AssistantError("CONFIG", `${key} \u5FC5\u987B\u662F\u5E03\u5C14\u503C`);
  }
  if (!["ghost", "panel"].includes(config.displayMode)) throw new AssistantError("CONFIG", "\u663E\u793A\u65B9\u5F0F\u5FC5\u987B\u662F ghost \u6216 panel");
  if (!["light", "standard", "deep"].includes(config.optimizationStrength)) throw new AssistantError("CONFIG", "\u4F18\u5316\u5F3A\u5EA6\u5FC5\u987B\u662F light\u3001standard \u6216 deep");
  if (!["concise", "standard", "detailed"].includes(config.predictionDetail)) throw new AssistantError("CONFIG", "\u9884\u6D4B\u8BE6\u7565\u5EA6\u5FC5\u987B\u662F concise\u3001standard \u6216 detailed");
  for (const [key, [min, max]] of Object.entries(numeric)) {
    const value = config[key];
    if (typeof value !== "number" || !Number.isInteger(value) || value < min || value > max) {
      throw new AssistantError("CONFIG", `${key} \u5FC5\u987B\u662F ${min} \u5230 ${max} \u4E4B\u95F4\u7684\u6574\u6570`);
    }
  }
  for (const key of strings) {
    if (typeof config[key] !== "string" || config[key].length > 200) throw new AssistantError("CONFIG", `${key} \u65E0\u6548`);
    config[key] = config[key].trim();
  }
  if (Boolean(config.provider) !== Boolean(config.model)) throw new AssistantError("CONFIG", "\u56FA\u5B9A\u8F85\u52A9\u6A21\u578B\u9700\u540C\u65F6\u586B\u5199\u63D0\u4F9B\u5546\u548C\u6A21\u578B\uFF1B\u7559\u7A7A\u5219\u8DDF\u968F\u8F93\u5165\u6846");
  return config;
}
function resolveConfig(input = {}) {
  for (const key of Object.keys(input)) if (!(key in DEFAULT_CONFIG)) throw new AssistantError("CONFIG", `\u672A\u77E5\u914D\u7F6E\uFF1A${key}`);
  return validate({ ...DEFAULT_CONFIG, ...input });
}

// src/browser/settings.tsx
var import_jsx_runtime2 = require("react/jsx-runtime");
var NUMBERS = [
  ["debounceMs", "\u7EED\u5199\u505C\u987F", "\u6BEB\u79D2", 200, 5e3, 50],
  ["minIntervalMs", "\u7EED\u5199\u8BF7\u6C42\u6700\u5C0F\u95F4\u9694", "\u6BEB\u79D2", 500, 3e4, 100],
  ["maxHistoryChars", "\u4F1A\u8BDD\u4E0A\u4E0B\u6587\u4E0A\u9650", "\u5B57\u7B26", 1e3, 64e3, 500],
  ["maxDraftChars", "\u5F85\u5904\u7406\u8349\u7A3F\u4E0A\u9650", "\u5B57\u7B26", 100, 32e3, 100],
  ["maxNextChars", "\u4E0B\u4E00\u53E5\u957F\u5EA6\u4E0A\u9650", "\u5B57\u7B26", 20, 300, 10],
  ["maxCompletionChars", "\u7EED\u5199\u957F\u5EA6\u4E0A\u9650", "\u5B57\u7B26", 10, 200, 5],
  ["optimizeTimeoutMs", "\u4F18\u5316\u8D85\u65F6", "\u6BEB\u79D2", 1e3, 12e4, 1e3],
  ["suggestionTimeoutMs", "\u81EA\u52A8\u5EFA\u8BAE\u8D85\u65F6", "\u6BEB\u79D2", 1e3, 6e4, 500]
];
var PRESETS = [
  {
    id: "agile",
    name: "\u654F\u6377\u6A21\u5F0F",
    desc: "\u4F4E\u5EF6\u8FDF\u5FEB\u901F\u54CD\u5E94\uFF0C\u9002\u5408\u6D41\u7545\u5199\u4F5C\u4E0E\u7075\u611F\u8FF8\u53D1",
    values: {
      debounceMs: 300,
      minIntervalMs: 1e3,
      optimizationStrength: "light",
      predictionDetail: "concise",
      maxNextChars: 60,
      maxCompletionChars: 40
    }
  },
  {
    id: "standard",
    name: "\u6807\u51C6\u5E73\u8861",
    desc: "\u5E73\u8861\u54CD\u5E94\u65F6\u673A\u4E0E\u6A21\u578B\u5F00\u9500\uFF0C\u9002\u5408\u65E5\u5E38\u5BF9\u8BDD\u4E0E\u5DE5\u4F5C",
    values: {
      debounceMs: 600,
      minIntervalMs: 2e3,
      optimizationStrength: "standard",
      predictionDetail: "standard",
      maxNextChars: 120,
      maxCompletionChars: 80
    }
  },
  {
    id: "eco",
    name: "\u8282\u6D41\u7701\u6D41",
    desc: "\u8F83\u5927\u9632\u6296\u4E0E\u95F4\u9694\uFF0C\u907F\u514D\u9891\u7E41\u8BF7\u6C42\uFF0C\u8282\u7701\u6A21\u578B\u7528\u91CF",
    values: {
      debounceMs: 1500,
      minIntervalMs: 5e3,
      optimizationStrength: "standard",
      predictionDetail: "concise",
      maxNextChars: 80,
      maxCompletionChars: 40
    }
  }
];
function formatHint(key, value, unit) {
  if (Number.isNaN(value) || typeof value !== "number") return "\u672A\u586B\u5199";
  if (unit === "\u6BEB\u79D2") {
    if (value >= 1e3) {
      const sec = (value / 1e3).toFixed(value % 1e3 === 0 ? 0 : 1);
      return `\u7EA6 ${sec} \u79D2`;
    }
    return `${value} \u6BEB\u79D2`;
  }
  return `${value} ${unit}`;
}
function AssistantSettings({ runtime }) {
  const generation = (0, import_react2.useSyncExternalStore)(
    runtime.connection.generation.subscribe.bind(runtime.connection.generation),
    () => runtime.transport.generation(),
    () => null
  );
  const [accepted, setAccepted] = (0, import_react2.useState)(null);
  const [form, setForm] = (0, import_react2.useState)({ ...DEFAULT_CONFIG });
  const [loading, setLoading] = (0, import_react2.useState)(true);
  const [saving, setSaving] = (0, import_react2.useState)(false);
  const [message, setMessage] = (0, import_react2.useState)("");
  const [error, setError] = (0, import_react2.useState)("");
  (0, import_react2.useEffect)(() => {
    const abort = new AbortController();
    setLoading(true);
    setError("");
    setMessage("");
    if (generation === null) {
      setLoading(false);
      setError("\u8FDE\u63A5\u5DF2\u65AD\u5F00\uFF0C\u8BF7\u91CD\u8FDE\u540E\u52A0\u8F7D\u8BBE\u7F6E");
      return () => abort.abort();
    }
    void runtime.transport.call("settings/get", {}, abort.signal).then((settings) => {
      if (abort.signal.aborted) return;
      const normalized = resolveConfig(settings);
      setAccepted(normalized);
      setForm(normalized);
      setLoading(false);
    }).catch((reason) => {
      if (!abort.signal.aborted) {
        setLoading(false);
        setError(reason instanceof Error ? reason.message : "\u8BBE\u7F6E\u52A0\u8F7D\u5931\u8D25");
      }
    });
    return () => abort.abort();
  }, [runtime, generation]);
  const change = (key, value) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    setMessage("");
    setError("");
  };
  const applyPreset = (preset) => {
    setForm((previous) => ({ ...previous, ...preset.values }));
    setMessage(`\u5DF2\u5957\u7528\u300C${preset.name}\u300D\u9884\u8BBE\u6863\u4F4D\uFF08\u70B9\u51FB\u4FDD\u5B58\u8BBE\u7F6E\u751F\u6548\uFF09`);
    setError("");
  };
  const save = async (event) => {
    event.preventDefault();
    if (!accepted || saving || generation === null) return;
    setError("");
    setMessage("");
    let draft;
    try {
      draft = resolveConfig(form);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "\u8BBE\u7F6E\u65E0\u6548");
      return;
    }
    setSaving(true);
    try {
      const patch = Object.fromEntries(
        Object.entries(draft).filter(([key, value]) => value !== accepted[key])
      );
      const settings = await runtime.saveSettings(patch);
      if (runtime.transport.generation() !== generation) return;
      setAccepted(settings);
      setForm(settings);
      setMessage("\u8BBE\u7F6E\u5DF2\u4FDD\u5B58\u5E76\u751F\u6548");
    } catch (reason) {
      setError(`\u4FDD\u5B58\u672A\u786E\u8BA4\uFF1A${reason instanceof Error ? reason.message : "\u8BF7\u91CD\u8BD5"}\uFF1B\u8BF7\u91CD\u65B0\u6253\u5F00\u8BBE\u7F6E\u6838\u5BF9`);
    } finally {
      setSaving(false);
    }
  };
  const changed = accepted !== null && JSON.stringify(form) !== JSON.stringify(accepted);
  return /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("form", { className: "dsh-ia dsh-ia-settings", "aria-label": "\u8F93\u5165\u52A9\u624B\u8BBE\u7F6E", onSubmit: (event) => {
    void save(event);
  }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h2", { children: "\u8F93\u5165\u52A9\u624B" }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", children: "\u5E2E\u52A9\u4F60\u5F62\u6210\u51C6\u786E\u3001\u53EF\u53D1\u9001\u7684\u8F93\u5165\u3002\u5404\u529F\u80FD\u72EC\u7ACB\u5F00\u5173\uFF0C\u91C7\u7EB3\u5185\u5BB9\u540E\u4ECD\u7531\u4F60\u53D1\u9001\u3002" }),
    loading && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: "\u6B63\u5728\u52A0\u8F7D\u8BBE\u7F6E\u2026" }),
    message && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "status", children: message }),
    error && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { role: "alert", children: error }),
    /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("fieldset", { disabled: loading || saving || generation === null || !accepted, children: [
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u63A8\u8350\u914D\u7F6E\u6863\u4F4D" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", children: "\u5FEB\u901F\u5207\u6362\u5E38\u7528\u7B56\u7565\u4E0E\u65F6\u673A\u9884\u8BBE\uFF0C\u4E5F\u53EF\u5728\u4E0B\u65B9\u5404\u914D\u7F6E\u9879\u4E2D\u8FDB\u4E00\u6B65\u5FAE\u8C03\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-ia-row", style: { gap: "8px", marginTop: "6px" }, children: PRESETS.map((preset) => /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            onClick: () => applyPreset(preset),
            title: preset.desc,
            children: preset.name
          },
          preset.id
        )) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u529F\u80FD\u5F00\u5173" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-ia-settings-toggles", children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                type: "checkbox",
                checked: form.optimizeEnabled,
                onChange: (event) => change("optimizeEnabled", event.target.checked)
              }
            ),
            "\u63D0\u793A\u8BCD\u4F18\u5316"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                type: "checkbox",
                checked: form.nextEnabled,
                onChange: (event) => change("nextEnabled", event.target.checked)
              }
            ),
            "\u56DE\u590D\u540E\u9884\u6D4B"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                type: "checkbox",
                checked: form.completionEnabled,
                onChange: (event) => change("completionEnabled", event.target.checked)
              }
            ),
            "\u8F93\u5165\u7EED\u5199"
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                type: "checkbox",
                checked: form.stashEnabled,
                onChange: (event) => change("stashEnabled", event.target.checked)
              }
            ),
            "\u8349\u7A3F\u6682\u5B58"
          ] })
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", style: { marginTop: "8px" }, children: "\u5173\u95ED\u6682\u5B58\u540E\u4ECD\u53EF\u67E5\u770B\u548C\u5220\u9664\u5386\u53F2\u8349\u7A3F\uFF1B\u5DF2\u6709\u4F18\u5316\u6539\u52A8\u4ECD\u53EF\u67E5\u770B\u548C\u8FD8\u539F\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u4F18\u5316\u4E0E\u5EFA\u8BAE" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u4F18\u5316\u5F3A\u5EA6",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "select",
            {
              value: form.optimizationStrength,
              onChange: (event) => change("optimizationStrength", event.target.value),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "light", children: "\u8F7B\u5EA6\u6DA6\u8272" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "standard", children: "\u6807\u51C6\u4F18\u5316" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "deep", children: "\u6DF1\u5EA6\u68B3\u7406" })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", children: "\u8F7B\u5EA6\u6DA6\u8272\u53EA\u4FEE\u6B63\u8868\u8FBE\uFF1B\u6807\u51C6\u4F18\u5316\u6574\u7406\u76EE\u6807\u4E0E\u7EA6\u675F\uFF1B\u6DF1\u5EA6\u68B3\u7406\u53EF\u91CD\u7EC4\u7ED3\u6784\u3002\u5404\u6863\u4F4D\u5747\u8981\u6C42\u4FDD\u7559\u539F\u610F\uFF0C\u4E0D\u65B0\u589E\u4EFB\u52A1\u6216\u6388\u6743\uFF1B\u5E94\u7528\u540E\u53EF\u67E5\u770B\u6539\u52A8\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u9884\u6D4B\u8BE6\u7565\u5EA6",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "select",
            {
              value: form.predictionDetail,
              onChange: (event) => change("predictionDetail", event.target.value),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "concise", children: "\u7B80\u660E" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "standard", children: "\u6807\u51C6" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "detailed", children: "\u8BE6\u5C3D" })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", children: "\u7B80\u660E\u504F\u5411\u77ED\u8BED\u8865\u5168\u4E0E\u5FEB\u901F\u63D0\u793A\uFF1B\u6807\u51C6\u5E73\u8861\u957F\u5EA6\u4E0E\u5B8C\u6574\u6027\uFF1B\u8BE6\u5C3D\u63D0\u4F9B\u5B8C\u6574\u6BB5\u843D\u5EFA\u8BAE\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u5EFA\u8BAE\u663E\u793A\u65B9\u5F0F",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
            "select",
            {
              value: form.displayMode,
              onChange: (event) => change("displayMode", event.target.value),
              children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "ghost", children: "\u7070\u5B57" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("option", { value: "panel", children: "\u5019\u9009\u9762\u677F" })
              ]
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", children: "\u7070\u5B57\u5728\u8F93\u5165\u6846\u5185\u8054\u63D0\u793A\uFF08Tab \u91C7\u7EB3\uFF09\uFF1B\u5019\u9009\u9762\u677F\u5C55\u793A\u6D6E\u52A8\u5907\u9009\u9879\u3002" })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u4F7F\u7528\u63D0\u793A\u4E0E\u4F53\u9A8C\u8BF4\u660E" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)(
          "div",
          {
            style: {
              padding: "12px 14px",
              borderRadius: "8px",
              background: "var(--dsw-alias-bg-module-platform, rgba(128, 128, 128, 0.06))",
              border: "1px solid var(--dsw-alias-border-l2, var(--dsh-ia-fallback-border))",
              display: "flex",
              flexDirection: "column",
              gap: "10px",
              fontSize: "12.5px",
              lineHeight: "1.6"
            },
            children: [
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { style: { color: "var(--dsw-alias-label-primary, inherit)" }, children: "1. \u7070\u5B57\u663E\u793A\u4E0E\u957F\u5185\u5BB9\u5904\u7406\uFF1A" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-ia-muted", style: { marginTop: "2px" }, children: [
                  "\u53D7\u5BBF\u4E3B\u539F\u751F\u8F93\u5165\u6846\u7684\u5BB9\u5668\u88C1\u526A\u9650\u5236\uFF0C\u884C\u5185\u7070\u5B57\u4EC5\u4F5C\u7B80\u77ED\u9884\u89C8\uFF0C\u53EF\u80FD\u65E0\u6CD5\u5B8C\u6574\u6362\u884C\u5C55\u793A\u957F\u6587\u672C\u3002\u82E5\u9700\u67E5\u770B\u5B8C\u6574\u5185\u5BB9\uFF0C\u53EF\u6309 ",
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("kbd", { style: { padding: "1px 5px", borderRadius: "4px", background: "var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15))", border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3))" }, children: "Tab" }),
                  " \u952E\u76F4\u63A5\u91C7\u7EB3\uFF0C\u6216\u70B9\u51FB\u4E00\u7EA7\u64CD\u4F5C\u680F\u4E2D\u7684\u300C\u9884\u6D4B\u300D\u6309\u94AE\u5C06\u5185\u5BB9\u76F4\u63A5\u4F5C\u4E3A\u771F\u5B9E\u6587\u672C\u586B\u5165\uFF0C\u7531\u539F\u751F\u8F93\u5165\u6846\u81EA\u9002\u5E94\u6491\u9AD8\u6362\u884C\uFF08\u652F\u6301 ",
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("kbd", { style: { padding: "1px 5px", borderRadius: "4px", background: "var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15))", border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3))" }, children: "Tab" }),
                  " \u91C7\u7EB3\u3001",
                  /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("kbd", { style: { padding: "1px 5px", borderRadius: "4px", background: "var(--dsw-alias-bg-layer-2, rgba(128, 128, 128, 0.15))", border: "1px solid var(--dsw-alias-border-l2, rgba(128, 128, 128, 0.3))" }, children: "Esc" }),
                  " \u5FFD\u7565\uFF09\u3002"
                ] })
              ] }),
              /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { children: [
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("strong", { style: { color: "var(--dsw-alias-label-primary, inherit)" }, children: "2. \u54CD\u5E94\u901F\u5EA6\u8BF4\u660E\uFF1A" }),
                /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { className: "dsh-ia-muted", style: { marginTop: "2px" }, children: "\u300C\u4F18\u5316\u300D\u4E0E\u300C\u9884\u6D4B\u300D\u7684\u751F\u6210\u8017\u65F6\u4E3B\u8981\u53D7\u8F85\u52A9\u6A21\u578B\u7684\u7F51\u7EDC\u5EF6\u8FDF\u53CA\u63A8\u7406\u8F93\u51FA\u901F\u5EA6\u5F71\u54CD\u3002\u5982\u9700\u66F4\u5FEB\u6377\u7684\u54CD\u5E94\u4F53\u9A8C\uFF0C\u53EF\u5728\u4E0B\u65B9\u300C\u8F85\u52A9\u6A21\u578B\u300D\u4E2D\u914D\u7F6E\u54CD\u5E94\u8FC5\u901F\u7684\u9AD8\u901F\u5C0F\u6A21\u578B\uFF0C\u6216\u76F4\u63A5\u9009\u7528\u9876\u90E8\u7684\u300C\u654F\u6377\u6A21\u5F0F\u300D\u9884\u8BBE\u3002" })
              ] })
            ]
          }
        )
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("section", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("h3", { children: "\u8F85\u52A9\u6A21\u578B" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", children: "\u4E24\u9879\u540C\u65F6\u7559\u7A7A\u65F6\u8DDF\u968F\u8F93\u5165\u6846\u6A21\u578B\u3002\u8F85\u52A9\u8C03\u7528\u5355\u72EC\u6D88\u8017\u6A21\u578B\u7528\u91CF\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u63D0\u4F9B\u5546",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              value: form.provider,
              onChange: (event) => change("provider", event.target.value),
              placeholder: "\u8DDF\u968F\u8F93\u5165\u6846",
              maxLength: 200,
              autoComplete: "off"
            }
          )
        ] }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { className: "dsh-ia-field", children: [
          "\u6A21\u578B",
          /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
            "input",
            {
              value: form.model,
              onChange: (event) => change("model", event.target.value),
              placeholder: "\u8DDF\u968F\u8F93\u5165\u6846",
              maxLength: 200,
              autoComplete: "off"
            }
          )
        ] })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("details", { className: "dsh-ia-section", children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("summary", { style: { cursor: "pointer", fontWeight: 600, padding: "4px 0" }, children: "\u9AD8\u7EA7\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("p", { className: "dsh-ia-muted", style: { margin: "8px 0 12px" }, children: "\u5FAE\u8C03\u9632\u6296\u505C\u987F\u3001\u8BF7\u6C42\u95F4\u9694\u4E0E\u957F\u5EA6\u9650\u5236\uFF0C\u652F\u6301\u6ED1\u5757\u76F4\u89C2\u8C03\u8282\u4E0E\u6570\u503C\u7CBE\u786E\u8F93\u5165\u3002" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("div", { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: "14px" }, children: NUMBERS.map(([key, label, unit, min, max, step]) => /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-ia-field", style: { margin: 0 }, children: [
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", justifyContent: "space-between", alignItems: "center" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("label", { htmlFor: `setting-${key}`, style: { cursor: "pointer", fontWeight: 500 }, children: [
              label,
              "\uFF08",
              unit,
              "\uFF09"
            ] }),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-ia-muted", style: { fontSize: "11px" }, children: formatHint(key, form[key], unit) })
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { style: { display: "flex", alignItems: "center", gap: "10px" }, children: [
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                id: `setting-${key}`,
                type: "number",
                "aria-label": `${label}\uFF08${unit}\uFF09`,
                value: Number.isNaN(form[key]) ? "" : form[key],
                min,
                max,
                step: 1,
                required: true,
                onChange: (event) => change(key, event.target.value === "" ? NaN : Number(event.target.value)),
                style: { width: "100px", flex: "0 0 auto" }
              }
            ),
            /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
              "input",
              {
                type: "range",
                tabIndex: -1,
                "aria-hidden": "true",
                min,
                max,
                step,
                value: Number.isNaN(form[key]) ? min : form[key],
                onChange: (event) => change(key, Number(event.target.value)),
                style: { flex: 1, accentColor: "var(--dsh-ia-accent, #3b82f6)" }
              }
            )
          ] }),
          /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("span", { className: "dsh-ia-muted", style: { fontSize: "11px" }, children: [
            min.toLocaleString(),
            "\u2013",
            max.toLocaleString(),
            " ",
            unit
          ] })
        ] }, key)) })
      ] }),
      /* @__PURE__ */ (0, import_jsx_runtime2.jsxs)("div", { className: "dsh-ia-row", style: { marginTop: "16px", gap: "12px" }, children: [
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("button", { type: "submit", disabled: !changed, children: saving ? "\u4FDD\u5B58\u4E2D\u2026" : "\u4FDD\u5B58\u8BBE\u7F6E" }),
        /* @__PURE__ */ (0, import_jsx_runtime2.jsx)(
          "button",
          {
            type: "button",
            disabled: !changed,
            onClick: () => {
              if (accepted) setForm(accepted);
              setError("");
              setMessage("\u5DF2\u653E\u5F03\u672A\u4FDD\u5B58\u7684\u4FEE\u6539");
            },
            children: "\u653E\u5F03\u4FEE\u6539"
          }
        ),
        changed && /* @__PURE__ */ (0, import_jsx_runtime2.jsx)("span", { className: "dsh-ia-muted", children: "\u6709\u672A\u4FDD\u5B58\u7684\u4FEE\u6539" })
      ] })
    ] })
  ] });
}

// src/browser/index.ts
var name = "input-assistant.client";
var inject = ["slots", "connection", "modelDirectories"];
function apply(ctx) {
  const connection = ctx.get("connection");
  const models = ctx.get("modelDirectories");
  const runtime = new BrowserRuntime(connection, models);
  ctx.effect(() => {
    const style = document.createElement("style");
    style.dataset.dshInputAssistant = "";
    style.textContent = STYLE_TEXT;
    document.head.append(style);
    return () => {
      runtime.dispose();
      style.remove();
    };
  }, "input-assistant: browser lifetime");
  ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
    name: "conversation.input.right",
    id: "input-assistant",
    order: 40,
    inject: () => ({ runtime })
  }, AssistantRight));
  ctx.slots.inject("conversation.input.overlay", () => ctx.slots.register({
    name: "conversation.input.overlay",
    id: "input-assistant",
    order: 40,
    inject: () => ({ runtime })
  }, AssistantOverlay));
  ctx.slots.inject("settings.section", () => ctx.slots.register({
    name: "settings.section",
    id: "input-assistant",
    order: 65,
    label: "\u8F93\u5165\u52A9\u624B",
    inject: () => ({ runtime })
  }, AssistantSettings));
}

return module.exports;
}});
