// AR-0 application kit (docs/build-specs/KIT.md). Redesigned screens import only from "@/components/kit".
// Radix, cmdk and vaul are used only inside this folder (guard 9.5).
// Logo (KIT 4.20) has no component: use next/image with "/brand/badge.svg".
export * from "./types";
export { Icon, ICON_NAMES, type IconName } from "./icons";
export { StatusPill, PILL_TONE } from "./status-pill";
export { ActionButton, actionButtonClass, type ActionButtonProps } from "./action-button";
export { ActionBar } from "./action-bar";
export { EmptyState } from "./empty-state";
export { Skeleton, ListSkeleton, RecordSkeleton, InboxSkeleton } from "./skeleton";
export { Toaster, toast, dismissToast, clearToasts, plainError, TOAST_MS, TOAST_UNDO_MS, type ToastInput } from "./toaster";
export { ConfirmDialog } from "./confirm-dialog";
export { Sheet, type SheetProps } from "./sheet";
export { ScreenHeader, type ScreenHeaderProps } from "./screen-header";
export { AreaTabs, currentAreaTab, type AreaTabItem } from "./area-tabs";
export { StatusTabs, statusTabHref, type StatusTabItem } from "./status-tabs";
export {
  Toolbar,
  ActiveFilterChips,
  applyFilters,
  activeFilterCount,
  readFilterValues,
  DATE_PRESETS,
  SEARCH_DEBOUNCE_MS,
  type FilterDef,
  type FilterOption,
  type SortDef,
  type ViewDef,
  type ToolbarProps,
} from "./toolbar";
export { DataTable, LOAD_MORE_LABEL, CAP_REACHED_LABEL, type Column, type DataTableProps } from "./data-table";
export { SidePanel } from "./side-panel";
export { RecordHeader, StatStrip, recordBarActions, mapHref, type RecordHeaderProps, type StatItem } from "./record-header";
export { NextStepCard, NEXT_STEP_EYEBROW } from "./next-step-card";
export { InboxCard, type InboxCardProps } from "./inbox-card";
export { Timeline, type TimelineItem } from "./timeline";
export { Fab } from "./fab";
export { OverflowMenu } from "./overflow-menu";
export { DecisionCard, type DecisionCardProps } from "./decision-card";
export { InfoTip } from "./info-tip";
export { useMediaQuery, DESKTOP_QUERY } from "./use-media-query";
export { OfflineBar, useDeskOffline } from "./offline-bar";
export { RegisterDeskServiceWorker } from "./register-sw";
export { DeskShortcuts, deskShortcutHref, shortcutTypingTarget, ignoreDeskShortcut } from "./shortcuts";
export { AutoRefresh, refreshPermitted, freshnessLabel, IDLE_LIMIT_MS, RETURN_AFTER_MS } from "./auto-refresh";
export { PullToRefresh, pullDistance, canPullRefresh, PULL_REFRESH_THRESHOLD } from "./pull-to-refresh";
export { RememberList, rememberedListHref, followRememberedClick, readListPosition, saveListPosition, clearRememberedLists } from "./remember-list";
export { useOptimisticAction, type OptimisticChangeOptions, type OptimisticFormAction } from "./use-optimistic-action";
