import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
  type UIEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { convertFileSrc, invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Clock3,
  Copy,
  ExternalLink,
  FileImage,
  FolderPlus,
  Grid2X2,
  Images,
  ImagePlus,
  Info,
  Languages,
  List,
  Maximize2,
  MoveRight,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Search,
  Settings,
  SlidersHorizontal,
  Star,
  Tag as TagIcon,
  Tags,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from "lucide-react";
import { useVirtualizer } from "@tanstack/react-virtual";
import "./App.css";
import {
  clamp,
  megabytesToBytesOrNull,
  numberOrNull,
  parseDraggedImageIds,
  settingValue,
} from "./lib/app-utils";

type AppStatus = {
  product_name: string;
  version: string;
  paths: {
    app_data_dir: string;
    database_path: string;
    thumbnails_dir: string;
  };
  schema_version: number;
  current_schema_version: number;
  collection_count: number;
  image_count: number;
  tag_count: number;
};

type ImportCollectionResult = {
  collection: {
    id: string;
    name: string;
  };
  scannedCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
};

type ImportFolderResult = {
  rootPath: string;
  collectionCount: number;
  scannedCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  skippedDirCount: number;
  results: ImportCollectionResult[];
};

type ImportFolderProgress = {
  rootPath: string;
  currentPath: string;
  currentName: string;
  phase: "preparing" | "scanning" | "skipped" | "imported" | "completed";
  processedCount: number;
  totalCount: number;
  collectionCount: number;
  scannedCount: number;
  insertedCount: number;
  updatedCount: number;
  errorCount: number;
  skippedDirCount: number;
};

type Collection = {
  id: string;
  path: string;
  displayPath?: string;
  name: string;
  coverImageId: string | null;
  description: string;
  rating: number;
  isFavorite: boolean;
  imageCount: number;
  totalSizeBytes: number;
  importedAt: string;
  updatedAt: string;
  lastViewedAt: string | null;
  viewCount: number;
};

type CollectionDraft = {
  name: string;
  description: string;
  rating: number;
};

type CollectionSortKey = "imported" | "name" | "images" | "size";
type CollectionViewMode = "grid" | "list";
type ImageViewMode = "list" | "grid";
type NavigationView = "all" | "favorites" | "recent" | "tags" | "settings";

type ImageRecord = {
  id: string;
  collectionId: string;
  path: string;
  displayPath?: string;
  fileName: string;
  extension: string;
  format: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  importedAt: string;
  rating: number;
  isFavorite: boolean;
  isMissing: boolean;
};

type PhotoTag = {
  id: string;
  name: string;
  color: string;
  createdAt: string;
  updatedAt: string;
};

type TagAssignment = {
  targetId: string;
  tag: PhotoTag;
};

type SearchResults = {
  collections: Collection[];
  images: ImageRecord[];
  tags: PhotoTag[];
};

type SettingRecord = {
  key: string;
  value: string;
  updatedAt: string;
};

type DataFileResult = {
  path: string;
  message: string;
};

type DuplicateGroup = {
  id: string;
  kind: string;
  score: number;
  totalSizeBytes: number;
  images: ImageRecord[];
};

type DuplicateDetectionResult = {
  scannedCount: number;
  hashedCount: number;
  failedCount: number;
  exactGroups: DuplicateGroup[];
  similarGroups: DuplicateGroup[];
};

type Thumbnail = {
  imageId: string;
  cachePath: string;
  url: string;
  width: number;
  height: number;
  status: string;
};

type ViewerImageAsset = {
  imageId: string;
  assetPath: string;
  url: string;
  width: number;
  height: number;
  format: string;
  kind: string;
  status: string;
};

type ViewerFitMode = "fit" | "actual";
type ImageLoadState = "loading" | "loaded" | "error";
type AppLanguage = "zh-CN" | "en-US";
type TranslationParams = Record<string, number | string>;

type ImageContextMenu = {
  imageId: string;
  x: number;
  y: number;
};

type TagAssignmentTarget =
  | { kind: "collection"; collection: Collection }
  | { kind: "image"; image: ImageRecord }
  | { kind: "batch"; images: ImageRecord[] };

type TagAssignmentMode = "replace" | "add" | "remove";

const SEARCH_FORMATS = ["jpg", "png", "gif", "webp", "avif", "svg", "bmp", "tiff", "ico"];
const COLLECTION_BATCH_SIZE = 80;
const DEFAULT_LANGUAGE: AppLanguage = "zh-CN";

const UI_TEXT = {
  navAll: { "zh-CN": "全部", "en-US": "All" },
  navFavorites: { "zh-CN": "收藏", "en-US": "Favorites" },
  navRecent: { "zh-CN": "最近", "en-US": "Recent" },
  navTags: { "zh-CN": "标签", "en-US": "Tags" },
  navSettings: { "zh-CN": "设置", "en-US": "Settings" },
  languageToggle: { "zh-CN": "语言", "en-US": "Language" },
  switchToEnglish: { "zh-CN": "切换到英文", "en-US": "Switch to English" },
  switchToChinese: { "zh-CN": "切换到中文", "en-US": "Switch to Chinese" },
  search: { "zh-CN": "搜索", "en-US": "Search" },
  searching: { "zh-CN": "搜索中", "en-US": "Searching" },
  searchPlaceholder: {
    "zh-CN": "搜索合集、路径或描述",
    "en-US": "Search collections, paths, or descriptions",
  },
  navigation: { "zh-CN": "PhotoView 导航", "en-US": "PhotoView navigation" },
  filter: { "zh-CN": "筛选", "en-US": "Filter" },
  duplicateDetection: { "zh-CN": "重复检测", "en-US": "Duplicates" },
  duplicateDetecting: { "zh-CN": "重复检测中", "en-US": "Checking duplicates" },
  detecting: { "zh-CN": "检测中", "en-US": "Checking" },
  duplicateShort: { "zh-CN": "重复", "en-US": "Dupes" },
  syncLibrary: { "zh-CN": "同步图库", "en-US": "Sync library" },
  syncing: { "zh-CN": "同步中", "en-US": "Syncing" },
  syncShort: { "zh-CN": "同步", "en-US": "Sync" },
  importFolder: { "zh-CN": "导入文件夹", "en-US": "Import folder" },
  importAction: { "zh-CN": "导入", "en-US": "Import" },
  cancelImport: { "zh-CN": "取消导入", "en-US": "Cancel import" },
  cancel: { "zh-CN": "取消", "en-US": "Cancel" },
  importing: { "zh-CN": "导入中", "en-US": "Importing" },
  advancedSearch: { "zh-CN": "高级搜索", "en-US": "Advanced search" },
  advancedSearchHint: {
    "zh-CN": "组合格式、尺寸、日期和状态，快速缩小图库范围。",
    "en-US": "Combine format, dimensions, date, and status to narrow the library.",
  },
  commonFilters: { "zh-CN": "常用条件", "en-US": "Common" },
  imageAttributeFilters: { "zh-CN": "图片属性", "en-US": "Image attributes" },
  timeFilters: { "zh-CN": "时间范围", "en-US": "Time range" },
  format: { "zh-CN": "格式", "en-US": "Format" },
  tagsLabel: { "zh-CN": "标签", "en-US": "Tags" },
  width: { "zh-CN": "宽度", "en-US": "Width" },
  minWidth: { "zh-CN": "最小宽度", "en-US": "Minimum width" },
  maxWidth: { "zh-CN": "最大宽度", "en-US": "Maximum width" },
  minPlaceholder: { "zh-CN": "最小", "en-US": "min" },
  maxPlaceholder: { "zh-CN": "最大", "en-US": "max" },
  height: { "zh-CN": "高度", "en-US": "Height" },
  dimensions: { "zh-CN": "尺寸", "en-US": "Dimensions" },
  minHeight: { "zh-CN": "最小高度", "en-US": "Minimum height" },
  maxHeight: { "zh-CN": "最大高度", "en-US": "Maximum height" },
  sizeMb: { "zh-CN": "文件大小", "en-US": "File size" },
  minSize: { "zh-CN": "最小大小", "en-US": "Minimum size" },
  maxSize: { "zh-CN": "最大大小", "en-US": "Maximum size" },
  rating: { "zh-CN": "评分", "en-US": "Rating" },
  minRating: { "zh-CN": "最低评分", "en-US": "Minimum rating" },
  maxRating: { "zh-CN": "最高评分", "en-US": "Maximum rating" },
  date: { "zh-CN": "日期", "en-US": "Date" },
  startDate: { "zh-CN": "开始日期", "en-US": "Start date" },
  endDate: { "zh-CN": "结束日期", "en-US": "End date" },
  favorite: { "zh-CN": "收藏", "en-US": "Favorite" },
  favoriteImages: { "zh-CN": "收藏", "en-US": "Favorite" },
  unfavoriteImages: { "zh-CN": "取消收藏", "en-US": "Unfavorite" },
  favoriteState: { "zh-CN": "收藏状态", "en-US": "Favorite status" },
  any: { "zh-CN": "不限", "en-US": "Any" },
  favorited: { "zh-CN": "已收藏", "en-US": "Favorited" },
  notFavorited: { "zh-CN": "未收藏", "en-US": "Not favorited" },
  applyFilters: { "zh-CN": "应用筛选", "en-US": "Apply" },
  reset: { "zh-CN": "重置", "en-US": "Reset" },
  searchResults: { "zh-CN": "搜索结果", "en-US": "Search results" },
  closeSearchResults: { "zh-CN": "关闭搜索结果", "en-US": "Close search results" },
  collections: { "zh-CN": "合集", "en-US": "Collections" },
  images: { "zh-CN": "图片", "en-US": "Images" },
  noCollections: { "zh-CN": "无合集", "en-US": "No collections" },
  noImages: { "zh-CN": "无图片", "en-US": "No images" },
  noTags: { "zh-CN": "无标签", "en-US": "No tags" },
  duplicateResults: { "zh-CN": "重复检测结果", "en-US": "Duplicate results" },
  closeDuplicateResults: {
    "zh-CN": "关闭重复检测结果",
    "en-US": "Close duplicate results",
  },
  duplicateSummary: {
    "zh-CN": "重复检测：{hashed}/{scanned} 张",
    "en-US": "Duplicates: {hashed}/{scanned} images",
  },
  noDuplicateImages: { "zh-CN": "未发现重复图片", "en-US": "No duplicate images found" },
  backToCollections: { "zh-CN": "返回合集", "en-US": "Back to collections" },
  favoriteCollection: { "zh-CN": "收藏合集", "en-US": "Favorite collection" },
  unfavoriteCollection: { "zh-CN": "取消收藏合集", "en-US": "Unfavorite collection" },
  setCollectionTags: { "zh-CN": "设置合集标签", "en-US": "Set collection tags" },
  editCollection: { "zh-CN": "编辑合集", "en-US": "Edit collection" },
  deleteCollectionRecord: {
    "zh-CN": "删除合集记录",
    "en-US": "Delete collection record",
  },
  openLocation: { "zh-CN": "打开所在位置", "en-US": "Open location" },
  allTags: { "zh-CN": "全部标签", "en-US": "All tags" },
  imageTagFilter: { "zh-CN": "图片标签筛选", "en-US": "Image tag filter" },
  imageView: { "zh-CN": "图片视图", "en-US": "Image view" },
  imageListView: { "zh-CN": "图片列表视图", "en-US": "Image list view" },
  imageGridView: { "zh-CN": "图片网格视图", "en-US": "Image grid view" },
  listView: { "zh-CN": "列表视图", "en-US": "List view" },
  gridView: { "zh-CN": "网格视图", "en-US": "Grid view" },
  collectionTags: { "zh-CN": "合集标签", "en-US": "Collection tags" },
  imageSelectionActions: { "zh-CN": "图片选择操作", "en-US": "Image selection actions" },
  selectVisibleImages: { "zh-CN": "选择当前筛选", "en-US": "Select visible" },
  clearVisibleSelection: { "zh-CN": "取消当前选择", "en-US": "Clear visible" },
  clearSelection: { "zh-CN": "清空选择", "en-US": "Clear selection" },
  batchImageActions: { "zh-CN": "批量图片操作", "en-US": "Batch image actions" },
  selectedImageCount: { "zh-CN": "已选 {count} 张", "en-US": "{count} selected" },
  move: { "zh-CN": "移动", "en-US": "Move" },
  copy: { "zh-CN": "复制", "en-US": "Copy" },
  copyPaths: { "zh-CN": "复制路径", "en-US": "Copy paths" },
  tag: { "zh-CN": "标签", "en-US": "Tags" },
  delete: { "zh-CN": "删除", "en-US": "Delete" },
  clear: { "zh-CN": "清空", "en-US": "Clear" },
  imageMoveTargets: { "zh-CN": "图片移动目标", "en-US": "Image move targets" },
  moveToCollection: { "zh-CN": "移动到 {name}", "en-US": "Move to {name}" },
  collectionImageCount: { "zh-CN": "{count} 张", "en-US": "{count} images" },
  loading: { "zh-CN": "加载中", "en-US": "Loading" },
  readingImageIndex: { "zh-CN": "正在读取图片索引。", "en-US": "Reading image index." },
  selectImage: { "zh-CN": "选择图片", "en-US": "Select image" },
  imageTags: { "zh-CN": "图片标签", "en-US": "Image tags" },
  setImageTags: { "zh-CN": "设置图片标签", "en-US": "Set image tags" },
  setAsCover: { "zh-CN": "设为封面", "en-US": "Set as cover" },
  renameImage: { "zh-CN": "重命名图片", "en-US": "Rename image" },
  moveImage: { "zh-CN": "移动图片", "en-US": "Move image" },
  copyImage: { "zh-CN": "复制图片", "en-US": "Copy image" },
  deleteImage: { "zh-CN": "删除图片", "en-US": "Delete image" },
  unknownDimensions: { "zh-CN": "尺寸未知", "en-US": "Unknown dimensions" },
  noMatchingImages: { "zh-CN": "没有匹配图片", "en-US": "No matching images" },
  noImagesYet: { "zh-CN": "暂无图片", "en-US": "No images yet" },
  adjustTagFilter: { "zh-CN": "调整标签筛选后再试。", "en-US": "Adjust the tag filter and try again." },
  reimportCheckPermissions: {
    "zh-CN": "重新导入或检查文件夹权限后再试。",
    "en-US": "Re-import or check folder permissions, then try again.",
  },
  settings: { "zh-CN": "设置", "en-US": "Settings" },
  settingsSubtitle: {
    "zh-CN": "偏好与本地数据管理",
    "en-US": "Preferences and local data management",
  },
  preferences: { "zh-CN": "偏好", "en-US": "Preferences" },
  theme: { "zh-CN": "主题", "en-US": "Theme" },
  system: { "zh-CN": "系统", "en-US": "System" },
  light: { "zh-CN": "浅色", "en-US": "Light" },
  dark: { "zh-CN": "深色", "en-US": "Dark" },
  language: { "zh-CN": "语言", "en-US": "Language" },
  languageChinese: { "zh-CN": "简体中文", "en-US": "Chinese" },
  languageEnglish: { "zh-CN": "English", "en-US": "English" },
  shortcuts: { "zh-CN": "快捷键", "en-US": "Shortcuts" },
  defaultShortcut: { "zh-CN": "默认", "en-US": "Default" },
  minimalShortcut: { "zh-CN": "精简", "en-US": "Minimal" },
  thumbnails: { "zh-CN": "缩略图", "en-US": "Thumbnails" },
  savePreferences: { "zh-CN": "保存偏好", "en-US": "Save preferences" },
  dataManagement: { "zh-CN": "数据管理", "en-US": "Data management" },
  databaseStorage: { "zh-CN": "数据库存储", "en-US": "Database storage" },
  currentDatabasePath: { "zh-CN": "当前数据库路径", "en-US": "Current database path" },
  databaseStorageDescription: {
    "zh-CN": "迁移后立即使用新位置，旧库会移动为 photoview.sqlite.bak。",
    "en-US":
      "After moving, PhotoView uses the new location immediately. The old database is moved as photoview.sqlite.bak.",
  },
  databasePathDesktopOnly: {
    "zh-CN": "仅桌面应用显示实际路径",
    "en-US": "The actual path appears in the desktop app",
  },
  dataTools: { "zh-CN": "数据工具", "en-US": "Data tools" },
  changeDatabasePath: { "zh-CN": "更改位置", "en-US": "Change location" },
  changingDatabasePath: { "zh-CN": "正在迁移", "en-US": "Moving" },
  backupDatabase: { "zh-CN": "备份数据库", "en-US": "Back up database" },
  restoreDatabase: { "zh-CN": "恢复数据库", "en-US": "Restore database" },
  rebuildIndex: { "zh-CN": "重建索引", "en-US": "Rebuild index" },
  exportData: { "zh-CN": "导出数据", "en-US": "Export data" },
  tagCount: { "zh-CN": "{count} 个标签", "en-US": "{count} tags" },
  editTag: { "zh-CN": "编辑标签", "en-US": "Edit tag" },
  newTag: { "zh-CN": "新建标签", "en-US": "New tag" },
  tagName: { "zh-CN": "标签名称", "en-US": "Tag name" },
  color: { "zh-CN": "颜色", "en-US": "Color" },
  tagColor: { "zh-CN": "标签颜色", "en-US": "Tag color" },
  cancelEdit: { "zh-CN": "取消编辑", "en-US": "Cancel editing" },
  saving: { "zh-CN": "保存中", "en-US": "Saving" },
  saveTag: { "zh-CN": "保存标签", "en-US": "Save tag" },
  addTag: { "zh-CN": "添加标签", "en-US": "Add tag" },
  noTagsYet: { "zh-CN": "暂无标签", "en-US": "No tags yet" },
  collectionSort: { "zh-CN": "合集排序", "en-US": "Collection sort" },
  recentImport: { "zh-CN": "最近导入", "en-US": "Recent import" },
  name: { "zh-CN": "名称", "en-US": "Name" },
  imageCount: { "zh-CN": "图片数量", "en-US": "Image count" },
  storageSize: { "zh-CN": "占用空间", "en-US": "Storage size" },
  tagFilter: { "zh-CN": "标签筛选", "en-US": "Tag filter" },
  collectionView: { "zh-CN": "合集视图", "en-US": "Collection view" },
  initializing: { "zh-CN": "初始化中", "en-US": "Initializing" },
  readingCollectionIndex: {
    "zh-CN": "正在读取本地合集索引。",
    "en-US": "Reading the local collection index.",
  },
  copiedPath: { "zh-CN": "复制路径", "en-US": "Copy path" },
  loadMoreCollections: { "zh-CN": "加载更多合集", "en-US": "Load more collections" },
  noMatchingCollections: { "zh-CN": "没有匹配合集", "en-US": "No matching collections" },
  noCollectionsYet: { "zh-CN": "暂无合集", "en-US": "No collections yet" },
  adjustSearchKeywords: {
    "zh-CN": "调整搜索关键词后再试。",
    "en-US": "Adjust the search keywords and try again.",
  },
  importFolderEmptyDescription: {
    "zh-CN": "选择本地图片文件夹后，PhotoView 会在本机建立索引。",
    "en-US": "Choose a local image folder and PhotoView will index it on this device.",
  },
  selectedImportFolder: {
    "zh-CN": "已选择的导入文件夹",
    "en-US": "Selected import folder",
  },
  importProgress: { "zh-CN": "导入进度", "en-US": "Import progress" },
  generatedCollections: {
    "zh-CN": "已生成 {count} 个合集",
    "en-US": "{count} collections generated",
  },
  importingDatabase: { "zh-CN": "正在初始化数据库", "en-US": "Initializing database" },
  statusImageCount: { "zh-CN": "{count} 张图片", "en-US": "{count} images" },
  statusTagCount: { "zh-CN": "{count} 个标签", "en-US": "{count} tags" },
  open: { "zh-CN": "打开", "en-US": "Open" },
  rename: { "zh-CN": "重命名", "en-US": "Rename" },
  info: { "zh-CN": "信息", "en-US": "Info" },
  closeEdit: { "zh-CN": "关闭编辑", "en-US": "Close editor" },
  description: { "zh-CN": "描述", "en-US": "Description" },
  save: { "zh-CN": "保存", "en-US": "Save" },
  setTags: { "zh-CN": "设置标签", "en-US": "Set tags" },
  closeTagSettings: { "zh-CN": "关闭标签设置", "en-US": "Close tag settings" },
  tagAssignmentMode: { "zh-CN": "标签操作", "en-US": "Tag action" },
  replaceTags: { "zh-CN": "替换", "en-US": "Replace" },
  addTags: { "zh-CN": "添加", "en-US": "Add" },
  removeTags: { "zh-CN": "移除", "en-US": "Remove" },
  tagOptions: { "zh-CN": "标签选项", "en-US": "Tag options" },
  selectedTags: { "zh-CN": "已选标签", "en-US": "Selected tags" },
  selectedTagsCount: { "zh-CN": "已选择 {count} 个标签", "en-US": "{count} tags selected" },
  selectTags: { "zh-CN": "选择标签", "en-US": "Select tags" },
  noTagsSelected: { "zh-CN": "未选择标签", "en-US": "No tags selected" },
  imageViewer: { "zh-CN": "图片查看器", "en-US": "Image viewer" },
  viewerToolbar: { "zh-CN": "查看器工具栏", "en-US": "Viewer toolbar" },
  fit: { "zh-CN": "适应", "en-US": "Fit" },
  zoomOut: { "zh-CN": "缩小", "en-US": "Zoom out" },
  zoomIn: { "zh-CN": "放大", "en-US": "Zoom in" },
  rotate90: { "zh-CN": "旋转 90 度", "en-US": "Rotate 90 degrees" },
  fullscreen: { "zh-CN": "全屏", "en-US": "Fullscreen" },
  pauseSlideshow: { "zh-CN": "暂停幻灯片", "en-US": "Pause slideshow" },
  startSlideshow: { "zh-CN": "开始幻灯片", "en-US": "Start slideshow" },
  imageInfo: { "zh-CN": "图片信息", "en-US": "Image info" },
  closeViewer: { "zh-CN": "关闭查看器", "en-US": "Close viewer" },
  previousImage: { "zh-CN": "上一张", "en-US": "Previous image" },
  nextImage: { "zh-CN": "下一张", "en-US": "Next image" },
  loadingImage: { "zh-CN": "正在加载图片", "en-US": "Loading image" },
  imageDecodeFailed: { "zh-CN": "图片解码失败", "en-US": "Image decode failed" },
  unknown: { "zh-CN": "未知", "en-US": "Unknown" },
  path: { "zh-CN": "路径", "en-US": "Path" },
  exactDuplicate: { "zh-CN": "完全重复", "en-US": "Exact duplicate" },
  similarDuplicate: { "zh-CN": "相似 {score}", "en-US": "Similar {score}" },
  deleteRest: { "zh-CN": "删除其余", "en-US": "Delete rest" },
  keep: { "zh-CN": "保留", "en-US": "Keep" },
  candidate: { "zh-CN": "候选", "en-US": "Candidate" },
  tagFilterTitle: { "zh-CN": "标签：{name}", "en-US": "Tag: {name}" },
  tagFilterFallback: { "zh-CN": "标签筛选", "en-US": "Tag filter" },
  favoritesCollections: { "zh-CN": "收藏合集", "en-US": "Favorite collections" },
  recentViewed: { "zh-CN": "最近浏览", "en-US": "Recently viewed" },
  allCollections: { "zh-CN": "全部合集", "en-US": "All collections" },
  importDone: { "zh-CN": "导入完成", "en-US": "Import complete" },
  imported: { "zh-CN": "已导入", "en-US": "Imported" },
  skipped: { "zh-CN": "已跳过", "en-US": "Skipped" },
  preparingImport: { "zh-CN": "准备导入", "en-US": "Preparing import" },
  scanning: { "zh-CN": "正在扫描", "en-US": "Scanning" },
  directories: { "zh-CN": "目录", "en-US": "folders" },
  collectionRating: { "zh-CN": "评分 {rating}/5", "en-US": "Rating {rating}/5" },
  collectionCountStatus: {
    "zh-CN": "{rendered}/{visible}/{total} 个合集",
    "en-US": "{rendered}/{visible}/{total} collections",
  },
  folderSynced: { "zh-CN": "文件夹变更已同步", "en-US": "Folder changes synced" },
  importCompletedNotice: {
    "zh-CN": "导入 {collections} 个合集：扫描 {scanned} 张，新增 {inserted} 张，更新 {updated} 张，错误 {errors} 个",
    "en-US": "Imported {collections} collections: scanned {scanned}, added {inserted}, updated {updated}, errors {errors}",
  },
  importProgressNotice: {
    "zh-CN": "{action} {name}，目录 {processed}/{total}，生成 {collections} 个合集",
    "en-US": "{action} {name}, folders {processed}/{total}, {collections} collections generated",
  },
  locatedImage: { "zh-CN": "已定位图片", "en-US": "Image located" },
  desktopImportFolder: {
    "zh-CN": "请在桌面应用中导入文件夹",
    "en-US": "Import folders in the desktop app",
  },
  importingFolder: { "zh-CN": "正在导入文件夹", "en-US": "Importing folder" },
  importCancelledRefreshed: {
    "zh-CN": "导入已取消，已刷新已导入合集",
    "en-US": "Import canceled; imported collections refreshed",
  },
  cancellingImport: { "zh-CN": "正在取消导入", "en-US": "Canceling import" },
  desktopSyncFolder: {
    "zh-CN": "请在桌面应用中同步文件夹",
    "en-US": "Sync folders in the desktop app",
  },
  foldersSynced: { "zh-CN": "文件夹已同步", "en-US": "Folders synced" },
  desktopSaveSettings: {
    "zh-CN": "请在桌面应用中保存设置",
    "en-US": "Save settings in the desktop app",
  },
  settingsSaved: { "zh-CN": "设置已保存", "en-US": "Settings saved" },
  desktopDataTools: {
    "zh-CN": "请在桌面应用中使用数据工具",
    "en-US": "Use data tools in the desktop app",
  },
  backupPathPrompt: { "zh-CN": "备份数据库路径", "en-US": "Backup database path" },
  restoreOverwriteConfirm: {
    "zh-CN": "恢复会覆盖当前数据库，继续？",
    "en-US": "Restore will overwrite the current database. Continue?",
  },
  desktopRestoreDatabase: {
    "zh-CN": "请在桌面应用中恢复数据库",
    "en-US": "Restore the database in the desktop app",
  },
  desktopDatabaseStorage: {
    "zh-CN": "请在桌面应用中修改数据库路径",
    "en-US": "Change the database path in the desktop app",
  },
  databaseMoveConfirm: {
    "zh-CN": "将数据库迁移到这个文件夹并立即使用新位置？\n{path}\n\n旧库会移动到新文件夹并命名为 photoview.sqlite.bak，原数据库文件路径会清空。",
    "en-US":
      "Move the database to this folder and use the new location now?\n{path}\n\nThe old database will move to the new folder as photoview.sqlite.bak, and the original database file path will be cleared.",
  },
  desktopCopyPath: {
    "zh-CN": "请在桌面应用中复制路径",
    "en-US": "Copy paths in the desktop app",
  },
  pathCopied: { "zh-CN": "路径已复制", "en-US": "Path copied" },
  desktopOpenLocation: {
    "zh-CN": "请在桌面应用中打开位置",
    "en-US": "Open locations in the desktop app",
  },
  desktopSearch: { "zh-CN": "请在桌面应用中搜索", "en-US": "Search in the desktop app" },
  searchCompletedNotice: {
    "zh-CN": "搜索完成：{collections} 个合集，{images} 张图片，{tags} 个标签",
    "en-US": "Search complete: {collections} collections, {images} images, {tags} tags",
  },
  filtersCleared: { "zh-CN": "筛选条件已清空", "en-US": "Filters cleared" },
  filteredTag: { "zh-CN": "已筛选标签：{name}", "en-US": "Filtered by tag: {name}" },
  desktopDuplicateDetection: {
    "zh-CN": "请在桌面应用中检测重复图片",
    "en-US": "Check duplicates in the desktop app",
  },
  duplicateCompletedNotice: {
    "zh-CN": "检测完成：扫描 {scanned} 张，完全重复 {exact} 组，相似 {similar} 组",
    "en-US": "Check complete: scanned {scanned}, exact {exact} groups, similar {similar} groups",
  },
  deleteDuplicateConfirm: {
    "zh-CN": "保留第一张，删除其余 {count} 张到回收站？",
    "en-US": "Keep the first image and move the other {count} to trash?",
  },
  deletedDuplicateImages: {
    "zh-CN": "已删除 {count} 张重复图片",
    "en-US": "Deleted {count} duplicate images",
  },
  desktopEditCollection: {
    "zh-CN": "请在桌面应用中编辑合集",
    "en-US": "Edit collections in the desktop app",
  },
  collectionSaved: { "zh-CN": "合集已保存", "en-US": "Collection saved" },
  desktopFavoriteCollection: {
    "zh-CN": "请在桌面应用中收藏合集",
    "en-US": "Favorite collections in the desktop app",
  },
  favoritedCollection: { "zh-CN": "已收藏合集", "en-US": "Collection favorited" },
  unfavoritedCollection: { "zh-CN": "已取消收藏", "en-US": "Collection unfavorited" },
  desktopSetCover: {
    "zh-CN": "请在桌面应用中设置封面",
    "en-US": "Set covers in the desktop app",
  },
  coverUpdated: { "zh-CN": "封面已更新", "en-US": "Cover updated" },
  desktopSaveTag: { "zh-CN": "请在桌面应用中保存标签", "en-US": "Save tags in the desktop app" },
  tagSaved: { "zh-CN": "标签已保存", "en-US": "Tag saved" },
  tagCreated: { "zh-CN": "标签已创建", "en-US": "Tag created" },
  deleteTagConfirm: {
    "zh-CN": "删除标签“{name}”？关联会一并移除。",
    "en-US": "Delete tag \"{name}\"? Related assignments will also be removed.",
  },
  desktopDeleteTag: { "zh-CN": "请在桌面应用中删除标签", "en-US": "Delete tags in the desktop app" },
  tagDeleted: { "zh-CN": "标签已删除", "en-US": "Tag deleted" },
  createTagFirst: { "zh-CN": "请先创建标签", "en-US": "Create a tag first" },
  desktopSetTags: { "zh-CN": "请在桌面应用中设置标签", "en-US": "Set tags in the desktop app" },
  collectionTagsUpdated: { "zh-CN": "合集标签已更新", "en-US": "Collection tags updated" },
  imageTagsUpdated: { "zh-CN": "图片标签已更新", "en-US": "Image tags updated" },
  batchTagsUpdated: {
    "zh-CN": "已设置 {count} 张图片的标签",
    "en-US": "Updated tags for {count} images",
  },
  batchTagsAdded: {
    "zh-CN": "已为 {count} 张图片添加标签",
    "en-US": "Added tags to {count} images",
  },
  batchTagsRemoved: {
    "zh-CN": "已从 {count} 张图片移除标签",
    "en-US": "Removed tags from {count} images",
  },
  selectTagsForBatch: {
    "zh-CN": "请先选择要添加或移除的标签",
    "en-US": "Select tags to add or remove first",
  },
  newFileNamePrompt: { "zh-CN": "新的文件名", "en-US": "New file name" },
  desktopRenameImage: {
    "zh-CN": "请在桌面应用中重命名图片",
    "en-US": "Rename images in the desktop app",
  },
  imageRenamed: { "zh-CN": "图片已重命名", "en-US": "Image renamed" },
  deleteImageConfirm: {
    "zh-CN": "删除图片“{name}”？默认移到系统回收站。",
    "en-US": "Delete image \"{name}\"? It will be moved to system trash by default.",
  },
  desktopDeleteImage: {
    "zh-CN": "请在桌面应用中删除图片",
    "en-US": "Delete images in the desktop app",
  },
  imageMovedToTrash: { "zh-CN": "图片已移到回收站", "en-US": "Image moved to trash" },
  noTargetCollections: { "zh-CN": "没有可用目标合集", "en-US": "No target collections available" },
  moveToCollectionTitle: { "zh-CN": "移动到合集", "en-US": "Move to collection" },
  copyToCollectionTitle: { "zh-CN": "复制到合集", "en-US": "Copy to collection" },
  desktopMoveImage: { "zh-CN": "请在桌面应用中移动图片", "en-US": "Move images in the desktop app" },
  movedImagesNotice: {
    "zh-CN": "已移动 {count} 张到 {name}",
    "en-US": "Moved {count} images to {name}",
  },
  desktopCopyImage: { "zh-CN": "请在桌面应用中复制图片", "en-US": "Copy images in the desktop app" },
  copiedImagesNotice: {
    "zh-CN": "已复制 {count} 张到 {name}",
    "en-US": "Copied {count} images to {name}",
  },
  batchMoveToCollectionTitle: { "zh-CN": "批量移动到合集", "en-US": "Batch move to collection" },
  batchCopyToCollectionTitle: { "zh-CN": "批量复制到合集", "en-US": "Batch copy to collection" },
  batchDeleteConfirm: {
    "zh-CN": "删除选中的 {count} 张图片？默认移到系统回收站。",
    "en-US": "Delete the selected {count} images? They will be moved to system trash by default.",
  },
  desktopBatchDelete: {
    "zh-CN": "请在桌面应用中批量删除图片",
    "en-US": "Batch delete images in the desktop app",
  },
  deletedImagesNotice: { "zh-CN": "已删除 {count} 张图片", "en-US": "Deleted {count} images" },
  ratingPrompt: { "zh-CN": "评分 0-5", "en-US": "Rating 0-5" },
  ratingError: {
    "zh-CN": "评分必须是 0 到 5 的整数",
    "en-US": "Rating must be an integer from 0 to 5",
  },
  desktopBatchRating: {
    "zh-CN": "请在桌面应用中批量评分",
    "en-US": "Batch rate images in the desktop app",
  },
  ratedImagesNotice: {
    "zh-CN": "已评分 {count} 张图片",
    "en-US": "Rated {count} images",
  },
  desktopBatchFavorite: {
    "zh-CN": "请在桌面应用中批量收藏图片",
    "en-US": "Batch favorite images in the desktop app",
  },
  batchFavoriteUpdated: {
    "zh-CN": "已更新 {count} 张图片的收藏状态",
    "en-US": "Updated favorite state for {count} images",
  },
  copiedImagePathsNotice: {
    "zh-CN": "已复制 {count} 张图片路径",
    "en-US": "Copied {count} image paths",
  },
  deleteCollectionConfirm: {
    "zh-CN": "删除合集记录“{name}”？磁盘文件夹不会被删除。",
    "en-US": "Delete collection record \"{name}\"? The folder on disk will not be deleted.",
  },
  desktopDeleteCollectionRecord: {
    "zh-CN": "请在桌面应用中删除合集记录",
    "en-US": "Delete collection records in the desktop app",
  },
  collectionRecordDeleted: {
    "zh-CN": "合集记录已删除，磁盘文件夹已保留",
    "en-US": "Collection record deleted; disk folder kept",
  },
  backupCreated: { "zh-CN": "数据库备份已创建", "en-US": "Database backup created" },
  databaseRestored: { "zh-CN": "数据库已从备份恢复", "en-US": "Database restored from backup" },
  databasePathChanged: { "zh-CN": "数据库路径已更新", "en-US": "Database path updated" },
  indexRebuilt: { "zh-CN": "索引已重建", "en-US": "Index rebuilt" },
  libraryExported: { "zh-CN": "图库数据已导出", "en-US": "Library data exported" },
} as const;

type TranslationKey = keyof typeof UI_TEXT;
type Translator = (key: TranslationKey, params?: TranslationParams) => string;
const LANGUAGE_OPTIONS: { value: AppLanguage; labelKey: TranslationKey; shortLabel: string }[] = [
  { value: "zh-CN", labelKey: "languageChinese", shortLabel: "中" },
  { value: "en-US", labelKey: "languageEnglish", shortLabel: "EN" },
];

function normalizeLanguage(value: string | null | undefined): AppLanguage {
  return value === "en-US" ? "en-US" : DEFAULT_LANGUAGE;
}

function translateText(
  language: AppLanguage,
  key: TranslationKey,
  params: TranslationParams = {},
): string {
  return UI_TEXT[key][language].replace(/\{(\w+)\}/g, (match, name) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : match,
  );
}

function createTranslator(language: AppLanguage): Translator {
  return (key, params) => translateText(language, key, params);
}

function App() {
  const [status, setStatus] = useState<AppStatus | null>(null);
  const [collections, setCollections] = useState<Collection[]>([]);
  const [collectionsLoading, setCollectionsLoading] = useState(false);
  const [selectedCollectionId, setSelectedCollectionId] = useState<string | null>(null);
  const [images, setImages] = useState<ImageRecord[]>([]);
  const [tags, setTags] = useState<PhotoTag[]>([]);
  const [collectionTagMap, setCollectionTagMap] = useState<Record<string, PhotoTag[]>>({});
  const [imageTagMap, setImageTagMap] = useState<Record<string, PhotoTag[]>>({});
  const [selectedTagFilterId, setSelectedTagFilterId] = useState("all");
  const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());
  const [imageContextMenu, setImageContextMenu] = useState<ImageContextMenu | null>(null);
  const [draggedImageIds, setDraggedImageIds] = useState<string[]>([]);
  const [dragOverCollectionId, setDragOverCollectionId] = useState<string | null>(null);
  const [thumbnails, setThumbnails] = useState<Record<string, Thumbnail>>({});
  const [thumbnailErrors, setThumbnailErrors] = useState<Record<string, string>>({});
  const [collectionCovers, setCollectionCovers] = useState<Record<string, Thumbnail>>({});
  const [collectionCoverErrors, setCollectionCoverErrors] = useState<Record<string, string>>({});
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedImportPath, setSelectedImportPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState<ImportFolderProgress | null>(null);
  const [isSyncing, setIsSyncing] = useState(false);
  const [isChangingDatabasePath, setIsChangingDatabasePath] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateDetectionResult | null>(null);
  const [isDetectingDuplicates, setIsDetectingDuplicates] = useState(false);
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [activeView, setActiveView] = useState<NavigationView>("all");
  const [theme, setTheme] = useState("system");
  const [language, setLanguage] = useState<AppLanguage>(DEFAULT_LANGUAGE);
  const [shortcutProfile, setShortcutProfile] = useState("default");
  const [thumbnailSize, setThumbnailSize] = useState("192");
  const [searchFormats, setSearchFormats] = useState<string[]>([]);
  const [searchTagIds, setSearchTagIds] = useState<string[]>([]);
  const [searchMinWidth, setSearchMinWidth] = useState("");
  const [searchMaxWidth, setSearchMaxWidth] = useState("");
  const [searchMinHeight, setSearchMinHeight] = useState("");
  const [searchMaxHeight, setSearchMaxHeight] = useState("");
  const [searchMinSizeMb, setSearchMinSizeMb] = useState("");
  const [searchMaxSizeMb, setSearchMaxSizeMb] = useState("");
  const [searchMinRating, setSearchMinRating] = useState("");
  const [searchMaxRating, setSearchMaxRating] = useState("");
  const [searchDateFrom, setSearchDateFrom] = useState("");
  const [searchDateTo, setSearchDateTo] = useState("");
  const [searchFavorite, setSearchFavorite] = useState("any");
  const [sortKey, setSortKey] = useState<CollectionSortKey>("imported");
  const [viewMode, setViewMode] = useState<CollectionViewMode>("grid");
  const [collectionRenderLimit, setCollectionRenderLimit] = useState(COLLECTION_BATCH_SIZE);
  const [imageViewMode, setImageViewMode] = useState<ImageViewMode>("list");
  const [imageGridColumnCount, setImageGridColumnCount] = useState(4);
  const [isCollectionEditorOpen, setIsCollectionEditorOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>({
    name: "",
    description: "",
    rating: 0,
  });
  const [isCollectionSaving, setIsCollectionSaving] = useState(false);
  const [tagDraftName, setTagDraftName] = useState("");
  const [tagDraftColor, setTagDraftColor] = useState("#4f7cff");
  const [editingTagId, setEditingTagId] = useState<string | null>(null);
  const [isTagSaving, setIsTagSaving] = useState(false);
  const [tagAssignmentTarget, setTagAssignmentTarget] = useState<TagAssignmentTarget | null>(null);
  const [tagAssignmentMode, setTagAssignmentMode] = useState<TagAssignmentMode>("replace");
  const [tagAssignmentIds, setTagAssignmentIds] = useState<string[]>([]);
  const [isTagAssignmentMenuOpen, setIsTagAssignmentMenuOpen] = useState(false);
  const [isTagAssignmentSaving, setIsTagAssignmentSaving] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerAsset, setViewerAsset] = useState<ViewerImageAsset | null>(null);
  const [viewerFitMode, setViewerFitMode] = useState<ViewerFitMode>("fit");
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerRotation, setViewerRotation] = useState(0);
  const [viewerImageState, setViewerImageState] = useState<ImageLoadState>("loading");
  const [isSlideshowActive, setIsSlideshowActive] = useState(false);
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(true);
  const importInFlight = useRef(false);
  const importProgressHideTimer = useRef<ReturnType<typeof window.setTimeout> | null>(null);
  const thumbnailRequests = useRef(new Set<string>());
  const collectionCoverRequests = useRef(new Set<string>());
  const viewerAssetRequest = useRef(0);
  const pendingImageFocusId = useRef<string | null>(null);
  const imageListRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const appLanguage = normalizeLanguage(language);
  const t = useMemo(() => createTranslator(appLanguage), [appLanguage]);
  const alternateLanguage: AppLanguage = appLanguage === "zh-CN" ? "en-US" : "zh-CN";

  function clearImportProgressHideTimer() {
    if (importProgressHideTimer.current === null) {
      return;
    }

    window.clearTimeout(importProgressHideTimer.current);
    importProgressHideTimer.current = null;
  }

  function hideImportProgressSoon() {
    clearImportProgressHideTimer();
    importProgressHideTimer.current = window.setTimeout(() => {
      setImportProgress(null);
      importProgressHideTimer.current = null;
    }, 1200);
  }

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );
  const isSettingsView = activeView === "settings" && !selectedCollection;
  const shouldShowLibraryToolbar = !isSettingsView;

  const selectedCollectionTags = selectedCollection
    ? collectionTagMap[selectedCollection.id] ?? []
    : [];
  const visibleImages = useMemo(() => {
    if (selectedTagFilterId === "all") {
      return images;
    }

    return images.filter((image) =>
      (imageTagMap[image.id] ?? []).some((tag) => tag.id === selectedTagFilterId),
    );
  }, [imageTagMap, images, selectedTagFilterId]);
  const activeImage = viewerIndex === null ? null : visibleImages[viewerIndex] ?? null;
  const thumbnailSizeNumber = clamp(Math.round(numberOrNull(thumbnailSize) ?? 192), 64, 512);
  const listThumbnailSize = clamp(Math.round(thumbnailSizeNumber * 0.36), 52, 96);
  const gridTileWidth = Math.max(144, thumbnailSizeNumber + 36);
  const imageVirtualCount =
    imageViewMode === "grid"
      ? Math.ceil(visibleImages.length / imageGridColumnCount)
      : visibleImages.length;
  const selectedImages = useMemo(
    () => images.filter((image) => selectedImageIds.has(image.id)),
    [images, selectedImageIds],
  );
  const selectedVisibleImageCount = useMemo(
    () => visibleImages.filter((image) => selectedImageIds.has(image.id)).length,
    [selectedImageIds, visibleImages],
  );
  const allVisibleImagesSelected =
    visibleImages.length > 0 && selectedVisibleImageCount === visibleImages.length;
  const contextImage = imageContextMenu
    ? images.find((image) => image.id === imageContextMenu.imageId) ?? null
    : null;
  const collectionDropTargets = useMemo(
    () => collections.filter((collection) => collection.id !== selectedCollectionId),
    [collections, selectedCollectionId],
  );
  const viewerImageSrc =
    activeImage && (!isTauriRuntime() || viewerAsset)
      ? convertImagePath(viewerAsset?.assetPath ?? activeImage.path)
      : null;
  const tagAssignmentTitle = tagAssignmentTarget
    ? tagAssignmentTarget.kind === "collection"
      ? t("tagFilterTitle", { name: tagAssignmentTarget.collection.name })
      : tagAssignmentTarget.kind === "image"
        ? `${t("imageTags")}: ${tagAssignmentTarget.image.fileName}`
        : `${t("setTags")}: ${t("statusImageCount", { count: tagAssignmentTarget.images.length })}`
    : t("setTags");

  const visibleCollections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const navFiltered = collections.filter((collection) => {
      if (activeView === "favorites") {
        return collection.isFavorite;
      }

      if (activeView === "recent") {
        return Boolean(collection.lastViewedAt);
      }

      return true;
    });
    const textFiltered = normalizedQuery
      ? navFiltered.filter((collection) =>
          [collection.name, displayCollectionPath(collection), collection.description]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : navFiltered;
    const filtered =
      selectedTagFilterId === "all"
        ? textFiltered
        : textFiltered.filter((collection) =>
            (collectionTagMap[collection.id] ?? []).some((tag) => tag.id === selectedTagFilterId),
          );

    if (activeView === "recent") {
      return [...filtered].sort((left, right) => {
        const leftTime = left.lastViewedAt ? new Date(left.lastViewedAt).getTime() : 0;
        const rightTime = right.lastViewedAt ? new Date(right.lastViewedAt).getTime() : 0;
        return rightTime - leftTime;
      });
    }

    return [...filtered].sort((left, right) => compareCollections(left, right, sortKey, appLanguage));
  }, [activeView, appLanguage, collectionTagMap, collections, query, selectedTagFilterId, sortKey]);
  const renderedCollections = useMemo(
    () => visibleCollections.slice(0, collectionRenderLimit),
    [collectionRenderLimit, visibleCollections],
  );
  const hasMoreCollections = renderedCollections.length < visibleCollections.length;

  const imageVirtualizer = useVirtualizer({
    count: imageVirtualCount,
    getScrollElement: () => imageListRef.current,
    estimateSize: () =>
      imageViewMode === "grid"
        ? Math.max(172, thumbnailSizeNumber + 58)
        : Math.max(104, listThumbnailSize + 40),
    overscan: 8,
  });

  useEffect(() => {
    void refreshAppData();
  }, []);

  useEffect(() => {
    return () => clearImportProgressHideTimer();
  }, []);

  useEffect(() => {
    if (selectedCollectionId) {
      closeViewer();
      void refreshImages(selectedCollectionId);
      return;
    }

    closeViewer();
    setImages([]);
    setImageTagMap({});
    setSelectedImageIds(new Set());
    setImageContextMenu(null);
    setDraggedImageIds([]);
    setDragOverCollectionId(null);
    setThumbnails({});
    setThumbnailErrors({});
    thumbnailRequests.current.clear();
  }, [selectedCollectionId]);

  useEffect(() => {
    if (!isTauriRuntime() || visibleImages.length === 0) {
      return;
    }

    const virtualItems = imageVirtualizer.getVirtualItems();
    const imagesToLoad =
      imageViewMode === "grid"
        ? virtualItems.flatMap((item) => {
            const rowStart = item.index * imageGridColumnCount;
            return visibleImages.slice(rowStart, rowStart + imageGridColumnCount);
          })
        : virtualItems.map((item) => visibleImages[item.index]).filter(Boolean);

    for (const image of imagesToLoad) {
      if (!image || thumbnails[image.id] || thumbnailErrors[image.id]) {
        continue;
      }

      if (thumbnailRequests.current.has(image.id)) {
        continue;
      }

      thumbnailRequests.current.add(image.id);
      void loadThumbnail(image.id);
    }
  });

  useEffect(() => {
    setThumbnails({});
    setThumbnailErrors({});
    setCollectionCovers({});
    setCollectionCoverErrors({});
    thumbnailRequests.current.clear();
    collectionCoverRequests.current.clear();
    imageVirtualizer.measure();
  }, [thumbnailSize]);

  useEffect(() => {
    imageVirtualizer.measure();
  }, [imageGridColumnCount, imageViewMode]);

  useEffect(() => {
    const element = imageListRef.current;
    if (!element) {
      return;
    }

    const updateGridColumns = () => {
      const availableWidth = Math.max(1, element.clientWidth - 24);
      setImageGridColumnCount(Math.max(1, Math.floor(availableWidth / gridTileWidth)));
    };

    updateGridColumns();
    if (typeof ResizeObserver === "undefined") {
      return;
    }

    const observer = new ResizeObserver(updateGridColumns);
    observer.observe(element);
    return () => observer.disconnect();
  }, [gridTileWidth, imageViewMode, selectedCollectionId]);

  useEffect(() => {
    if (!isTauriRuntime() || renderedCollections.length === 0) {
      return;
    }

    for (const collection of renderedCollections) {
      if (!collection.coverImageId) {
        continue;
      }

      const requestKey = `${collection.id}:${collection.coverImageId}:${thumbnailSize}`;
      if (
        collectionCovers[collection.id]?.imageId === collection.coverImageId ||
        collectionCoverErrors[requestKey] ||
        collectionCoverRequests.current.has(requestKey)
      ) {
        continue;
      }

      collectionCoverRequests.current.add(requestKey);
      void loadCollectionCover(collection, requestKey);
    }
  }, [collectionCoverErrors, collectionCovers, renderedCollections, thumbnailSize]);

  useEffect(() => {
    setCollectionRenderLimit(COLLECTION_BATCH_SIZE);
  }, [activeView, query, selectedTagFilterId, sortKey, viewMode]);

  useEffect(() => {
    if (!isTauriRuntime()) {
      return;
    }

    let unlistenImport: (() => void) | undefined;
    let unlistenSync: (() => void) | undefined;
    let unlistenImportProgress: (() => void) | undefined;

    listen("menu-import-folder", () => {
      void handleChooseImportFolder();
    }).then((value) => {
      unlistenImport = value;
    });

    listen<string>("library-synced", (event) => {
      void refreshAppData();
      if (selectedCollectionId === event.payload) {
        void refreshImages(event.payload);
      }
      setNotice(t("folderSynced"));
    }).then((value) => {
      unlistenSync = value;
    });

    listen<ImportFolderProgress>("import-folder-progress", (event) => {
      const progress = event.payload;
      setImportProgress(progress);
      if (progress.phase === "completed") {
        setNotice(
          t("importCompletedNotice", {
            collections: progress.collectionCount,
            scanned: progress.scannedCount,
            inserted: progress.insertedCount,
            updated: progress.updatedCount,
            errors: progress.errorCount,
          }),
        );
        hideImportProgressSoon();
        return;
      }

      clearImportProgressHideTimer();
      const action =
        progress.phase === "imported"
          ? t("imported")
          : progress.phase === "skipped"
            ? t("skipped")
            : t("scanning");
      setNotice(
        t("importProgressNotice", {
          action,
          name: progress.currentName,
          processed: progress.processedCount,
          total: progress.totalCount || "?",
          collections: progress.collectionCount,
        }),
      );
    }).then((value) => {
      unlistenImportProgress = value;
    });

    return () => {
      unlistenImport?.();
      unlistenSync?.();
      unlistenImportProgress?.();
    };
  }, [selectedCollectionId, t]);

  useEffect(() => {
    if (!activeImage) {
      setViewerAsset(null);
      return;
    }

    const requestId = viewerAssetRequest.current + 1;
    viewerAssetRequest.current = requestId;
    setViewerAsset(null);
    setViewerImageState("loading");

    if (isTauriRuntime()) {
      void loadViewerImage(activeImage.id, requestId);
    }
  }, [activeImage?.id]);

  useEffect(() => {
    if (!activeImage) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        closeViewer();
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        showPreviousImage();
        return;
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        showNextImage();
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activeImage, visibleImages.length]);

  useEffect(() => {
    if (!isSlideshowActive || !activeImage || visibleImages.length <= 1) {
      return;
    }

    const timer = window.setInterval(() => {
      showNextImage();
    }, 2000);

    return () => window.clearInterval(timer);
  }, [activeImage, isSlideshowActive, visibleImages.length]);

  useEffect(() => {
    if (!imageContextMenu) {
      return;
    }

    function closeMenu() {
      setImageContextMenu(null);
    }

    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [imageContextMenu]);

  async function refreshAppData() {
    await Promise.all([
      refreshStatus(),
      refreshCollections(),
      refreshTags(),
      refreshCollectionTagAssignments(),
      refreshSettings(),
    ]);
  }

  async function refreshStatus() {
    if (!isTauriRuntime()) {
      setStatus(mockStatus(collections.length, 0));
      return;
    }

    try {
      setStatus(await invoke<AppStatus>("get_app_status"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function refreshCollections() {
    setCollectionsLoading(true);

    if (!isTauriRuntime()) {
      setCollections([]);
      setCollectionsLoading(false);
      return;
    }

    try {
      setCollections(await invoke<Collection[]>("list_collections"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setCollectionsLoading(false);
    }
  }

  async function refreshTags() {
    if (!isTauriRuntime()) {
      setTags([]);
      setSelectedTagFilterId("all");
      return;
    }

    try {
      const nextTags = await invoke<PhotoTag[]>("list_tags");
      setTags(nextTags);
      setSelectedTagFilterId((current) =>
        current !== "all" && !nextTags.some((tag) => tag.id === current) ? "all" : current,
      );
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function refreshSettings() {
    if (!isTauriRuntime()) {
      return;
    }

    try {
      const records = await invoke<SettingRecord[]>("get_settings");
      const nextSettings = Object.fromEntries(records.map((setting) => [setting.key, setting.value]));
      setTheme(settingValue(nextSettings.theme, "system"));
      setLanguage(normalizeLanguage(settingValue(nextSettings.language, DEFAULT_LANGUAGE)));
      setShortcutProfile(settingValue(nextSettings.shortcut_profile, "default"));
      setThumbnailSize(settingValue(nextSettings.thumbnail_size, "192"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function refreshCollectionTagAssignments() {
    if (!isTauriRuntime()) {
      setCollectionTagMap({});
      return;
    }

    try {
      const assignments = await invoke<TagAssignment[]>("list_collection_tag_assignments", {
        request: { collectionId: null },
      });
      setCollectionTagMap(groupTagAssignments(assignments));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function refreshImageTagAssignments(collectionId: string) {
    if (!isTauriRuntime()) {
      setImageTagMap({});
      return;
    }

    try {
      const assignments = await invoke<TagAssignment[]>("list_image_tag_assignments", {
        request: { collectionId, imageId: null },
      });
      setImageTagMap(groupTagAssignments(assignments));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function refreshImages(collectionId: string) {
    setImagesLoading(true);

    if (!isTauriRuntime()) {
      setImages([]);
      setImageTagMap({});
      setImagesLoading(false);
      return;
    }

    try {
      const [nextImages, nextImageTagAssignments] = await Promise.all([
        invoke<ImageRecord[]>("list_images", {
          request: { collectionId, limit: 10000, offset: 0 },
        }),
        invoke<TagAssignment[]>("list_image_tag_assignments", {
          request: { collectionId, imageId: null },
        }),
      ]);
      setImages(nextImages);
      setImageTagMap(groupTagAssignments(nextImageTagAssignments));
      setSelectedImageIds(new Set());
      setImageContextMenu(null);
      setDraggedImageIds([]);
      setDragOverCollectionId(null);
      setThumbnails({});
      setThumbnailErrors({});
      thumbnailRequests.current.clear();
      const pendingImageId = pendingImageFocusId.current;
      if (pendingImageId) {
        pendingImageFocusId.current = null;
        if (nextImages.some((image) => image.id === pendingImageId)) {
          setSelectedImageIds(new Set([pendingImageId]));
          setNotice(t("locatedImage"));
          window.setTimeout(() => {
            const index = nextImages.findIndex((image) => image.id === pendingImageId);
            if (index >= 0) {
              imageVirtualizer.scrollToIndex(index, { align: "center" });
            }
          }, 0);
        }
      }
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setImagesLoading(false);
    }
  }

  async function loadThumbnail(imageId: string) {
    try {
      const thumbnail = await invoke<Thumbnail>("get_thumbnail", {
        imageId,
        targetSize: clamp(Math.round(numberOrNull(thumbnailSize) ?? 192), 64, 512),
      });

      setThumbnails((current) => ({ ...current, [imageId]: thumbnail }));
    } catch (value) {
      setThumbnailErrors((current) => ({
        ...current,
        [imageId]: invokeErrorMessage(value),
      }));
    }
  }

  async function loadCollectionCover(collection: Collection, requestKey: string) {
    if (!collection.coverImageId) {
      return;
    }

    try {
      const thumbnail = await invoke<Thumbnail>("get_thumbnail", {
        imageId: collection.coverImageId,
        targetSize: clamp(Math.round(numberOrNull(thumbnailSize) ?? 192), 96, 512),
      });

      setCollectionCovers((current) => ({ ...current, [collection.id]: thumbnail }));
    } catch (value) {
      setCollectionCoverErrors((current) => ({
        ...current,
        [requestKey]: invokeErrorMessage(value),
      }));
    }
  }

  async function loadViewerImage(imageId: string, requestId: number) {
    try {
      const asset = await invoke<ViewerImageAsset>("get_viewer_image", {
        imageId,
        maxSide: 4096,
      });

      if (viewerAssetRequest.current === requestId) {
        setViewerAsset(asset);
      }
    } catch (value) {
      if (viewerAssetRequest.current === requestId) {
        setViewerImageState("error");
        setError(invokeErrorMessage(value));
      }
    }
  }

  async function handleChooseImportFolder() {
    if (importInFlight.current) {
      return;
    }

    importInFlight.current = true;
    setError(null);
    setNotice(null);
    clearImportProgressHideTimer();
    setImportProgress(null);
    setIsImporting(true);

    if (!isTauriRuntime()) {
      setNotice(t("desktopImportFolder"));
      importInFlight.current = false;
      setIsImporting(false);
      return;
    }

    try {
      const folder = await invoke<string | null>("choose_import_folder");
      if (!folder) {
        setImportProgress(null);
        setIsImporting(false);
        return;
      }

      setSelectedImportPath(folder);
      setNotice(t("importingFolder"));

      const result = await invoke<ImportFolderResult>("import_folder", {
        request: { path: folder },
      });

      setNotice(
        t("importCompletedNotice", {
          collections: result.collectionCount,
          scanned: result.scannedCount,
          inserted: result.insertedCount,
          updated: result.updatedCount,
          errors: result.errorCount,
        }),
      );
      hideImportProgressSoon();
      await refreshAppData();
      setActiveView("all");
      setSelectedCollectionId(
        result.collectionCount === 1 ? result.results[0]?.collection.id ?? null : null,
      );
    } catch (value) {
      if (invokeErrorCode(value) === "operation_cancelled") {
        await refreshAppData();
        setActiveView("all");
        setSelectedCollectionId(null);
        setImportProgress(null);
        setNotice(t("importCancelledRefreshed"));
        return;
      }

      setError(invokeErrorMessage(value));
    } finally {
      importInFlight.current = false;
      setIsImporting(false);
    }
  }

  async function cancelImport() {
    if (!isImporting || !isTauriRuntime()) {
      return;
    }

    try {
      setNotice(t("cancellingImport"));
      await invoke("cancel_import");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function syncLibrary() {
    setError(null);
    setNotice(null);
    setIsSyncing(true);

    if (!isTauriRuntime()) {
      setNotice(t("desktopSyncFolder"));
      setIsSyncing(false);
      return;
    }

    try {
      if (selectedCollectionId) {
        await invoke("sync_collection", { id: selectedCollectionId });
        await refreshImages(selectedCollectionId);
      } else {
        await invoke("sync_all_collections");
      }
      await refreshAppData();
      setNotice(t("foldersSynced"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsSyncing(false);
    }
  }

  async function savePreferences() {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopSaveSettings"));
      return;
    }

    try {
      await Promise.all([
        saveSetting("theme", theme),
        saveSetting("language", language),
        saveSetting("shortcut_profile", shortcutProfile),
        saveSetting("thumbnail_size", thumbnailSize),
      ]);
      setNotice(t("settingsSaved"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function updateLanguagePreference(nextLanguage: AppLanguage) {
    if (nextLanguage === appLanguage) {
      return;
    }

    setLanguage(nextLanguage);
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      return;
    }

    try {
      await saveSetting("language", nextLanguage);
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function saveSetting(key: string, value: string) {
    const setting = await invoke<SettingRecord>("update_setting", {
      request: { key, value },
    });
    return setting;
  }

  async function runDataTool(command: "backup_database" | "rebuild_index" | "export_library_data") {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopDataTools"));
      return;
    }

    try {
      const result = await invoke<DataFileResult>(command);
      await refreshAppData();
      setNotice(formatDataToolNotice(command, result, t));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function restoreDatabase() {
    const path = window.prompt(t("backupPathPrompt"))?.trim();
    if (!path || !window.confirm(t("restoreOverwriteConfirm"))) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopRestoreDatabase"));
      return;
    }

    try {
      await invoke<DataFileResult>("restore_database_from_backup", { path });
      await refreshAppData();
      setNotice(t("databaseRestored"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function changeDatabaseStoragePath() {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopDatabaseStorage"));
      return;
    }

    try {
      const directory = await invoke<string | null>("choose_database_folder");
      if (!directory || !window.confirm(t("databaseMoveConfirm", { path: directory }))) {
        return;
      }

      setIsChangingDatabasePath(true);
      const result = await invoke<DataFileResult>("move_database_storage", { directory });
      await refreshAppData();
      setNotice(`${t("databasePathChanged")}: ${result.path}`);
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsChangingDatabasePath(false);
    }
  }

  async function handleCopyPath() {
    if (!selectedImportPath) {
      return;
    }

    await copyPath(selectedImportPath);
  }

  async function handleOpenPath() {
    if (!selectedImportPath) {
      return;
    }

    await openPath(selectedImportPath);
  }

  async function copyPath(path: string) {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopCopyPath"));
      return;
    }

    try {
      await invoke("copy_path_to_clipboard", { path });
      setNotice(t("pathCopied"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function openPath(path: string) {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopOpenLocation"));
      return;
    }

    try {
      await invoke("open_path_in_file_manager", { path });
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function performSearch() {
    setError(null);
    setNotice(null);
    setIsSearching(true);

    if (!isTauriRuntime()) {
      setNotice(t("desktopSearch"));
      setIsSearching(false);
      return;
    }

    try {
      const results = await invoke<SearchResults>("search_library", {
        request: {
          query: query.trim() || null,
          formats: searchFormats,
          minWidth: numberOrNull(searchMinWidth),
          maxWidth: numberOrNull(searchMaxWidth),
          minHeight: numberOrNull(searchMinHeight),
          maxHeight: numberOrNull(searchMaxHeight),
          minSizeBytes: megabytesToBytesOrNull(searchMinSizeMb),
          maxSizeBytes: megabytesToBytesOrNull(searchMaxSizeMb),
          tagIds: searchTagIds,
          minRating: numberOrNull(searchMinRating),
          maxRating: numberOrNull(searchMaxRating),
          dateFrom: searchDateFrom || null,
          dateTo: searchDateTo || null,
          isFavorite:
            searchFavorite === "any" ? null : searchFavorite === "favorite" ? true : false,
          limit: 500,
        },
      });
      setSearchResults(results);
      setNotice(
        t("searchCompletedNotice", {
          collections: results.collections.length,
          images: results.images.length,
          tags: results.tags.length,
        }),
      );
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsSearching(false);
    }
  }

  function clearSearchResults() {
    setSearchResults(null);
  }

  function resetSearchFilters() {
    setSearchFormats([]);
    setSearchTagIds([]);
    setSearchMinWidth("");
    setSearchMaxWidth("");
    setSearchMinHeight("");
    setSearchMaxHeight("");
    setSearchMinSizeMb("");
    setSearchMaxSizeMb("");
    setSearchMinRating("");
    setSearchMaxRating("");
    setSearchDateFrom("");
    setSearchDateTo("");
    setSearchFavorite("any");
    setSearchResults(null);
    setNotice(t("filtersCleared"));
  }

  function loadMoreCollections() {
    setCollectionRenderLimit((current) =>
      Math.min(current + COLLECTION_BATCH_SIZE, visibleCollections.length),
    );
  }

  function handleCollectionSurfaceScroll(event: UIEvent<HTMLElement>) {
    if (!hasMoreCollections) {
      return;
    }

    const element = event.currentTarget;
    if (element.scrollTop + element.clientHeight >= element.scrollHeight - 240) {
      loadMoreCollections();
    }
  }

  function openSearchCollection(collection: Collection) {
    clearSearchResults();
    openCollection(collection);
  }

  function openSearchImage(image: ImageRecord) {
    clearSearchResults();
    setSelectedTagFilterId("all");
    pendingImageFocusId.current = image.id;
    if (selectedCollectionId === image.collectionId) {
      void refreshImages(image.collectionId);
    } else {
      setSelectedCollectionId(image.collectionId);
    }
  }

  function openSearchTag(tag: PhotoTag) {
    clearSearchResults();
    setActiveView("all");
    setSelectedCollectionId(null);
    setSelectedTagFilterId(tag.id);
    setNotice(t("filteredTag", { name: tag.name }));
  }

  function showNavigationView(view: NavigationView) {
    setActiveView(view);
    setSelectedCollectionId(null);
    setError(null);
    setNotice(null);
    if (view === "all" || view === "favorites" || view === "recent") {
      setSelectedTagFilterId("all");
    }
  }

  async function runDuplicateDetection() {
    setError(null);
    setNotice(null);
    setIsDetectingDuplicates(true);

    if (!isTauriRuntime()) {
      setNotice(t("desktopDuplicateDetection"));
      setIsDetectingDuplicates(false);
      return;
    }

    try {
      const result = await invoke<DuplicateDetectionResult>("run_duplicate_detection", {
        request: {
          collectionId: selectedCollectionId,
          maxHammingDistance: 8,
        },
      });
      setDuplicateResult(result);
      setNotice(
        t("duplicateCompletedNotice", {
          scanned: result.scannedCount,
          exact: result.exactGroups.length,
          similar: result.similarGroups.length,
        }),
      );
      if (selectedCollectionId) {
        await refreshImages(selectedCollectionId);
      } else {
        await refreshCollections();
      }
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsDetectingDuplicates(false);
    }
  }

  async function deleteDuplicateRemainders(group: DuplicateGroup) {
    const removableImages = group.images.slice(1);
    if (removableImages.length === 0) {
      return;
    }

    if (!window.confirm(t("deleteDuplicateConfirm", { count: removableImages.length }))) {
      return;
    }

    const failed: string[] = [];
    for (const image of removableImages) {
      try {
        await invoke("delete_image_file", {
          request: { id: image.id, useTrash: true },
        });
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    const removedIds = new Set(removableImages.map((image) => image.id));
    setDuplicateResult((current) => (current ? removeDuplicateImages(current, removedIds) : current));
    removeImagesFromCurrentView([...removedIds]);
    await refreshCollections();
    await refreshStatus();
    setNotice(t("deletedDuplicateImages", { count: removableImages.length - failed.length }));
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  function openCollection(collection: Collection) {
    setActiveView("all");
    setSelectedCollectionId(collection.id);
    setNotice(null);
    setError(null);
    if (isTauriRuntime()) {
      void markCollectionViewed(collection.id);
    }
  }

  async function markCollectionViewed(collectionId: string) {
    try {
      const collection = await invoke<Collection>("mark_collection_viewed", { id: collectionId });
      updateCollectionState(collection);
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function updateCollectionState(collection: Collection) {
    setCollections((current) =>
      current.map((item) => (item.id === collection.id ? collection : item)),
    );
  }

  function openCollectionEditor(collection: Collection) {
    setCollectionDraft({
      name: collection.name,
      description: collection.description,
      rating: collection.rating,
    });
    setIsCollectionEditorOpen(true);
    setError(null);
    setNotice(null);
  }

  async function saveCollectionEditor(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedCollection) {
      return;
    }

    setIsCollectionSaving(true);
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopEditCollection"));
      setIsCollectionSaving(false);
      return;
    }

    try {
      const collection = await invoke<Collection>("update_collection", {
        request: {
          id: selectedCollection.id,
          name: collectionDraft.name,
          description: collectionDraft.description,
          rating: collectionDraft.rating,
        },
      });
      updateCollectionState(collection);
      setIsCollectionEditorOpen(false);
      setNotice(t("collectionSaved"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsCollectionSaving(false);
    }
  }

  async function toggleCollectionFavorite(collection: Collection) {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopFavoriteCollection"));
      return;
    }

    try {
      const updated = await invoke<Collection>("update_collection", {
        request: {
          id: collection.id,
          isFavorite: !collection.isFavorite,
        },
      });
      updateCollectionState(updated);
      setNotice(updated.isFavorite ? t("favoritedCollection") : t("unfavoritedCollection"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function setCollectionCover(image: ImageRecord) {
    if (!selectedCollection) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopSetCover"));
      return;
    }

    try {
      const collection = await invoke<Collection>("update_collection", {
        request: {
          id: selectedCollection.id,
          coverImageId: image.id,
        },
      });
      updateCollectionState(collection);
      setNotice(t("coverUpdated"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function resetTagDraft() {
    setTagDraftName("");
    setTagDraftColor("#4f7cff");
    setEditingTagId(null);
  }

  function startEditTag(tag: PhotoTag) {
    setTagDraftName(tag.name);
    setTagDraftColor(tag.color);
    setEditingTagId(tag.id);
    setActiveView("tags");
    setSelectedCollectionId(null);
    setError(null);
    setNotice(null);
  }

  async function saveTagDraft(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tagDraftName.trim();
    if (!name) {
      return;
    }

    setError(null);
    setNotice(null);
    setIsTagSaving(true);

    if (!isTauriRuntime()) {
      setNotice(t("desktopSaveTag"));
      setIsTagSaving(false);
      return;
    }

    try {
      if (editingTagId) {
        await invoke<PhotoTag>("update_tag", {
          request: { id: editingTagId, name, color: tagDraftColor },
        });
      } else {
        await invoke<PhotoTag>("create_tag", {
          request: { name, color: tagDraftColor },
        });
      }
      await refreshTags();
      await refreshCollectionTagAssignments();
      if (selectedCollectionId) {
        await refreshImageTagAssignments(selectedCollectionId);
      }
      await refreshStatus();
      resetTagDraft();
      setNotice(editingTagId ? t("tagSaved") : t("tagCreated"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsTagSaving(false);
    }
  }

  async function deleteTagRecord(tag: PhotoTag) {
    if (!window.confirm(t("deleteTagConfirm", { name: tag.name }))) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopDeleteTag"));
      return;
    }

    try {
      await invoke("delete_tag", { id: tag.id });
      await refreshTags();
      await refreshCollectionTagAssignments();
      if (selectedCollectionId) {
        await refreshImageTagAssignments(selectedCollectionId);
      }
      await refreshStatus();
      if (editingTagId === tag.id) {
        resetTagDraft();
      }
      setNotice(t("tagDeleted"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function openTagAssignment(target: TagAssignmentTarget, currentTags: PhotoTag[]) {
    if (tags.length === 0) {
      setNotice(t("createTagFirst"));
      setActiveView("tags");
      setSelectedCollectionId(null);
      return;
    }

    setTagAssignmentTarget(target);
    setTagAssignmentMode(target.kind === "batch" ? "add" : "replace");
    setTagAssignmentIds(target.kind === "batch" ? [] : currentTags.map((tag) => tag.id));
    setIsTagAssignmentMenuOpen(false);
    setError(null);
    setNotice(null);
  }

  function assignTagsToCollection(collection: Collection) {
    openTagAssignment(
      { kind: "collection", collection },
      collectionTagMap[collection.id] ?? [],
    );
  }

  function assignTagsToImage(image: ImageRecord) {
    openTagAssignment({ kind: "image", image }, imageTagMap[image.id] ?? []);
  }

  async function saveTagAssignment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!tagAssignmentTarget) {
      return;
    }

    setError(null);
    setNotice(null);
    setIsTagAssignmentSaving(true);

    if (
      tagAssignmentTarget.kind === "batch" &&
      tagAssignmentMode !== "replace" &&
      tagAssignmentIds.length === 0
    ) {
      setError(t("selectTagsForBatch"));
      setIsTagAssignmentSaving(false);
      return;
    }

    if (!isTauriRuntime()) {
      setNotice(t("desktopSetTags"));
      setIsTagAssignmentSaving(false);
      return;
    }

    try {
      if (tagAssignmentTarget.kind === "collection") {
        const assignedTags = await invoke<PhotoTag[]>("set_collection_tags", {
          request: { targetId: tagAssignmentTarget.collection.id, tagIds: tagAssignmentIds },
        });
        setCollectionTagMap((current) => ({
          ...current,
          [tagAssignmentTarget.collection.id]: assignedTags,
        }));
        setNotice(t("collectionTagsUpdated"));
      } else if (tagAssignmentTarget.kind === "image") {
        const assignedTags = await invoke<PhotoTag[]>("set_image_tags", {
          request: { targetId: tagAssignmentTarget.image.id, tagIds: tagAssignmentIds },
        });
        setImageTagMap((current) => ({
          ...current,
          [tagAssignmentTarget.image.id]: assignedTags,
        }));
        setNotice(t("imageTagsUpdated"));
      } else {
        const failed: string[] = [];
        let updatedCount = 0;
        for (const image of tagAssignmentTarget.images) {
          try {
            const currentTagIds = imageTagMap[image.id]?.map((tag) => tag.id) ?? [];
            const nextTagIds = mergeImageTagIds(
              currentTagIds,
              tagAssignmentIds,
              tagAssignmentMode,
            );
            const assignedTags = await invoke<PhotoTag[]>("set_image_tags", {
              request: { targetId: image.id, tagIds: nextTagIds },
            });
            setImageTagMap((current) => ({ ...current, [image.id]: assignedTags }));
            updatedCount += 1;
          } catch (value) {
            failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
          }
        }
        clearImageSelection();
        const noticeKey: TranslationKey =
          tagAssignmentMode === "add"
            ? "batchTagsAdded"
            : tagAssignmentMode === "remove"
              ? "batchTagsRemoved"
              : "batchTagsUpdated";
        setNotice(t(noticeKey, { count: updatedCount }));
        setError(failed.length > 0 ? failed.join("；") : null);
      }

      setTagAssignmentTarget(null);
      setTagAssignmentMode("replace");
      setTagAssignmentIds([]);
      setIsTagAssignmentMenuOpen(false);
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      setIsTagAssignmentSaving(false);
    }
  }

  async function renameImage(image: ImageRecord) {
    const fileName = window.prompt(t("newFileNamePrompt"), image.fileName)?.trim();
    if (!fileName || fileName === image.fileName) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopRenameImage"));
      return;
    }

    try {
      const updated = await invoke<ImageRecord>("rename_image_file", {
        request: { id: image.id, fileName },
      });
      setImages((current) => current.map((item) => (item.id === image.id ? updated : item)));
      await refreshCollections();
      setNotice(t("imageRenamed"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function moveImage(image: ImageRecord) {
    const target = chooseTargetCollection(t("moveToCollectionTitle"));
    if (!target) {
      return;
    }

    await moveImagesToCollection([image], target);
  }

  async function copyImage(image: ImageRecord) {
    const target = chooseTargetCollection(t("copyToCollectionTitle"));
    if (!target) {
      return;
    }

    await copyImagesToCollection([image], target);
  }

  async function deleteImage(image: ImageRecord) {
    if (!window.confirm(t("deleteImageConfirm", { name: image.fileName }))) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopDeleteImage"));
      return;
    }

    try {
      await invoke("delete_image_file", {
        request: { id: image.id, useTrash: true },
      });
      setImages((current) => current.filter((item) => item.id !== image.id));
      setThumbnails((current) => omitKey(current, image.id));
      setThumbnailErrors((current) => omitKey(current, image.id));
      thumbnailRequests.current.delete(image.id);
      if (activeImage?.id === image.id) {
        closeViewer();
      }
      await refreshCollections();
      await refreshStatus();
      setNotice(t("imageMovedToTrash"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function chooseTargetCollection(title: string): Collection | null {
    const candidates = collections.filter((collection) => collection.id !== selectedCollectionId);
    if (candidates.length === 0) {
      setNotice(t("noTargetCollections"));
      return null;
    }

    const options = candidates
      .map((collection, index) => `${index + 1}. ${collection.name}`)
      .join("\n");
    const value = window.prompt(`${title}\n${options}`)?.trim();
    if (!value) {
      return null;
    }

    const index = Number(value);
    if (Number.isInteger(index) && index >= 1 && index <= candidates.length) {
      return candidates[index - 1];
    }

    return candidates.find((collection) => collection.id === value) ?? null;
  }

  function toggleImageSelection(imageId: string) {
    setSelectedImageIds((current) => {
      const next = new Set(current);
      if (next.has(imageId)) {
        next.delete(imageId);
      } else {
        next.add(imageId);
      }
      return next;
    });
  }

  function clearImageSelection() {
    setSelectedImageIds(new Set());
  }

  function toggleVisibleImageSelection() {
    if (visibleImages.length === 0) {
      return;
    }

    setSelectedImageIds((current) => {
      const next = new Set(current);
      if (allVisibleImagesSelected) {
        for (const image of visibleImages) {
          next.delete(image.id);
        }
        return next;
      }

      for (const image of visibleImages) {
        next.add(image.id);
      }
      return next;
    });
  }

  function imageActionGroup(image: ImageRecord): ImageRecord[] {
    if (!selectedImageIds.has(image.id)) {
      return [image];
    }

    return images.filter((item) => selectedImageIds.has(item.id));
  }

  async function moveImagesToCollection(imagesToMove: ImageRecord[], target: Collection) {
    if (imagesToMove.length === 0) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopMoveImage"));
      return;
    }

    const failed: string[] = [];
    const movedIds: string[] = [];
    for (const image of imagesToMove) {
      try {
        await invoke<ImageRecord>("move_image_file", {
          request: { id: image.id, targetCollectionId: target.id },
        });
        movedIds.push(image.id);
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    removeImagesFromCurrentView(movedIds);
    await refreshCollections();
    await refreshStatus();
    setNotice(t("movedImagesNotice", { count: movedIds.length, name: target.name }));
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function copyImagesToCollection(imagesToCopy: ImageRecord[], target: Collection) {
    if (imagesToCopy.length === 0) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopCopyImage"));
      return;
    }

    const failed: string[] = [];
    let copiedCount = 0;
    for (const image of imagesToCopy) {
      try {
        await invoke<ImageRecord>("copy_image_file", {
          request: { id: image.id, targetCollectionId: target.id },
        });
        copiedCount += 1;
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    clearImageSelection();
    await refreshCollections();
    await refreshStatus();
    setNotice(t("copiedImagesNotice", { count: copiedCount, name: target.name }));
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  function removeImagesFromCurrentView(imageIds: string[]) {
    if (imageIds.length === 0) {
      return;
    }

    const imageIdSet = new Set(imageIds);
    setImages((current) => current.filter((image) => !imageIdSet.has(image.id)));
    setSelectedImageIds((current) => {
      const next = new Set(current);
      for (const imageId of imageIds) {
        next.delete(imageId);
      }
      return next;
    });
    setThumbnails((current) => omitKeys(current, imageIdSet));
    setThumbnailErrors((current) => omitKeys(current, imageIdSet));
    for (const imageId of imageIds) {
      thumbnailRequests.current.delete(imageId);
    }
    if (activeImage && imageIdSet.has(activeImage.id)) {
      closeViewer();
    }
  }

  async function batchMoveImages() {
    const target = chooseTargetCollection(t("batchMoveToCollectionTitle"));
    if (!target || selectedImages.length === 0) {
      return;
    }

    await moveImagesToCollection(selectedImages, target);
  }

  async function batchCopyImages() {
    const target = chooseTargetCollection(t("batchCopyToCollectionTitle"));
    if (!target || selectedImages.length === 0) {
      return;
    }

    await copyImagesToCollection(selectedImages, target);
  }

  async function batchSetImageTags() {
    if (selectedImages.length === 0) {
      return;
    }

    openTagAssignment(
      { kind: "batch", images: selectedImages },
      imageTagMap[selectedImages[0].id] ?? [],
    );
  }

  async function batchDeleteImages() {
    if (selectedImages.length === 0) {
      return;
    }

    if (!window.confirm(t("batchDeleteConfirm", { count: selectedImages.length }))) {
      return;
    }

    if (!isTauriRuntime()) {
      setNotice(t("desktopBatchDelete"));
      return;
    }

    setError(null);
    setNotice(null);

    const failed: string[] = [];
    const deletedIds: string[] = [];
    for (const image of selectedImages) {
      try {
        await invoke("delete_image_file", {
          request: { id: image.id, useTrash: true },
        });
        deletedIds.push(image.id);
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    removeImagesFromCurrentView(deletedIds);
    await refreshCollections();
    await refreshStatus();
    setNotice(t("deletedImagesNotice", { count: deletedIds.length }));
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function batchRateImages() {
    if (selectedImages.length === 0) {
      return;
    }

    const value = window.prompt(t("ratingPrompt"), "0")?.trim();
    if (value === undefined || value === null || value === "") {
      return;
    }

    const rating = Number(value);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      setError(t("ratingError"));
      return;
    }

    if (!isTauriRuntime()) {
      setNotice(t("desktopBatchRating"));
      return;
    }

    const failed: string[] = [];
    for (const image of selectedImages) {
      try {
        const updated = await invoke<ImageRecord>("update_image", {
          request: { id: image.id, rating },
        });
        setImages((current) =>
          current.map((item) => (item.id === updated.id ? updated : item)),
        );
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    clearImageSelection();
    setNotice(t("ratedImagesNotice", { count: selectedImages.length - failed.length }));
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function batchSetImageFavorite(isFavorite: boolean) {
    if (selectedImages.length === 0) {
      return;
    }

    if (!isTauriRuntime()) {
      setNotice(t("desktopBatchFavorite"));
      return;
    }

    setError(null);
    setNotice(null);

    const failed: string[] = [];
    const updatedImages: ImageRecord[] = [];
    for (const image of selectedImages) {
      try {
        const updated = await invoke<ImageRecord>("update_image", {
          request: { id: image.id, isFavorite },
        });
        updatedImages.push(updated);
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    if (updatedImages.length > 0) {
      const updatedMap = new Map(updatedImages.map((image) => [image.id, image]));
      setImages((current) => current.map((image) => updatedMap.get(image.id) ?? image));
    }
    clearImageSelection();
    setNotice(t("batchFavoriteUpdated", { count: updatedImages.length }));
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function batchCopyImagePaths() {
    if (selectedImages.length === 0) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopCopyPath"));
      return;
    }

    try {
      const text = selectedImages.map((image) => displayImagePath(image)).join("\n");
      await invoke("copy_text_to_clipboard", { text });
      setNotice(t("copiedImagePathsNotice", { count: selectedImages.length }));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function handleImageDragStart(event: DragEvent<HTMLElement>, image: ImageRecord) {
    const imagesToDrag = imageActionGroup(image);
    const imageIds = imagesToDrag.map((item) => item.id);
    setDraggedImageIds(imageIds);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("application/x-photoview-image-ids", JSON.stringify(imageIds));
    event.dataTransfer.setData("text/plain", imageIds.join(","));
  }

  function handleImageDragEnd() {
    setDraggedImageIds([]);
    setDragOverCollectionId(null);
  }

  async function dropImagesOnCollection(event: DragEvent<HTMLElement>, target: Collection) {
    event.preventDefault();
    event.stopPropagation();

    const rawIds = event.dataTransfer.getData("application/x-photoview-image-ids");
    const imageIds = parseDraggedImageIds(rawIds, draggedImageIds);
    const imageIdSet = new Set(imageIds);
    const imagesToMove = images.filter((image) => imageIdSet.has(image.id));

    handleImageDragEnd();
    await moveImagesToCollection(imagesToMove, target);
  }

  function handleCollectionDragOver(event: DragEvent<HTMLElement>, collectionId: string) {
    if (draggedImageIds.length === 0) {
      return;
    }

    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOverCollectionId(collectionId);
  }

  async function deleteCollectionRecord(collection: Collection | null) {
    if (!collection) {
      return;
    }

    const confirmed = window.confirm(t("deleteCollectionConfirm", { name: collection.name }));
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice(t("desktopDeleteCollectionRecord"));
      return;
    }

    try {
      await invoke("delete_collection_record", { id: collection.id });
      if (selectedCollectionId === collection.id) {
        setSelectedCollectionId(null);
        setImages([]);
        setThumbnails({});
        setThumbnailErrors({});
        thumbnailRequests.current.clear();
      }
      setCollectionCovers((current) => omitKey(current, collection.id));
      setCollections((current) =>
        current.filter((item) => item.id !== collection.id),
      );
      await refreshStatus();
      setNotice(t("collectionRecordDeleted"));
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function openViewer(index: number) {
    if (!visibleImages[index]) {
      return;
    }

    setViewerIndex(index);
    setViewerFitMode("fit");
    setViewerZoom(1);
    setViewerRotation(0);
    setViewerImageState("loading");
    setIsSlideshowActive(false);
    setIsInfoPanelOpen(true);
  }

  function closeViewer() {
    viewerAssetRequest.current += 1;
    setViewerIndex(null);
    setViewerAsset(null);
    setIsSlideshowActive(false);
  }

  function showPreviousImage() {
    setViewerIndex((current) => {
      if (current === null || visibleImages.length === 0) {
        return current;
      }

      return current === 0 ? visibleImages.length - 1 : current - 1;
    });
  }

  function showNextImage() {
    setViewerIndex((current) => {
      if (current === null || visibleImages.length === 0) {
        return current;
      }

      return current === visibleImages.length - 1 ? 0 : current + 1;
    });
  }

  function resetViewerTransform(mode: ViewerFitMode) {
    setViewerFitMode(mode);
    setViewerZoom(1);
  }

  function changeViewerZoom(delta: number) {
    setViewerFitMode("actual");
    setViewerZoom((current) => clamp(Number((current + delta).toFixed(2)), 0.25, 4));
  }

  function rotateViewer() {
    setViewerRotation((current) => (current + 90) % 360);
  }

  async function toggleFullscreen() {
    const element = viewerRef.current;
    if (!element) {
      return;
    }

    try {
      if (document.fullscreenElement) {
        await document.exitFullscreen();
      } else {
        await element.requestFullscreen();
      }
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  return (
    <main
      className="app-shell"
      data-language={appLanguage}
      data-theme={theme}
      style={appShellStyle(thumbnailSize)}
    >
      <aside className="sidebar" aria-label={t("navigation")}>
        <div className="brand">
          <img className="brand-mark" src="/favicon.png" alt="" aria-hidden="true" />
          <span>PhotoView</span>
        </div>
        <nav className="primary-nav">
          <button
            aria-label={t("navAll")}
            className={`nav-item ${activeView === "all" && !selectedCollection ? "active" : ""}`}
            type="button"
            onClick={() => showNavigationView("all")}
          >
            <Images size={17} aria-hidden="true" />
            <span>{t("navAll")}</span>
            <small>{collections.length}</small>
          </button>
          <button
            aria-label={t("navFavorites")}
            className={`nav-item ${
              activeView === "favorites" && !selectedCollection ? "active" : ""
            }`}
            type="button"
            onClick={() => showNavigationView("favorites")}
          >
            <Star size={17} aria-hidden="true" />
            <span>{t("navFavorites")}</span>
            <small>{collections.filter((collection) => collection.isFavorite).length}</small>
          </button>
          <button
            aria-label={t("navRecent")}
            className={`nav-item ${activeView === "recent" && !selectedCollection ? "active" : ""}`}
            type="button"
            onClick={() => showNavigationView("recent")}
          >
            <Clock3 size={17} aria-hidden="true" />
            <span>{t("navRecent")}</span>
            <small>{collections.filter((collection) => collection.lastViewedAt).length}</small>
          </button>
          <button
            aria-label={t("navTags")}
            className={`nav-item ${activeView === "tags" && !selectedCollection ? "active" : ""}`}
            type="button"
            onClick={() => showNavigationView("tags")}
          >
            <Tags size={17} aria-hidden="true" />
            <span>{t("navTags")}</span>
            <small>{tags.length}</small>
          </button>
        </nav>
        <nav className="utility-nav">
          <button
            aria-label={t(appLanguage === "zh-CN" ? "switchToEnglish" : "switchToChinese")}
            className="nav-item language-nav-button"
            title={t(appLanguage === "zh-CN" ? "switchToEnglish" : "switchToChinese")}
            type="button"
            onClick={() => void updateLanguagePreference(alternateLanguage)}
          >
            <Languages size={17} aria-hidden="true" />
            <span>{t("languageToggle")}</span>
            <small>{LANGUAGE_OPTIONS.find((option) => option.value === alternateLanguage)?.shortLabel}</small>
          </button>
          <button
            aria-label={t("navSettings")}
            className={`nav-item ${activeView === "settings" ? "active" : ""}`}
            type="button"
            onClick={() => showNavigationView("settings")}
          >
            <Settings size={17} aria-hidden="true" />
            <span>{t("navSettings")}</span>
          </button>
        </nav>
      </aside>

      <section className={`workspace ${shouldShowLibraryToolbar ? "" : "workspace-standalone"}`}>
        {shouldShowLibraryToolbar ? (
          <header className="toolbar">
            <input
              aria-label={t("search")}
              placeholder={t("searchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void performSearch();
                }
              }}
            />
            <button
              aria-label={t("filter")}
              className="secondary-action"
              type="button"
              aria-pressed={isAdvancedSearchOpen}
              title={t("filter")}
              onClick={() => setIsAdvancedSearchOpen((current) => !current)}
            >
              <SlidersHorizontal size={16} aria-hidden="true" />
              <span>{t("filter")}</span>
            </button>
            <button
              aria-label={isSearching ? t("searching") : t("search")}
              className="secondary-action"
              type="button"
              disabled={isSearching}
              aria-busy={isSearching}
              title={isSearching ? t("searching") : t("search")}
              onClick={() => void performSearch()}
            >
              <Search size={16} aria-hidden="true" />
              <span>{isSearching ? t("searching") : t("search")}</span>
            </button>
            <button
              aria-label={isDetectingDuplicates ? t("duplicateDetecting") : t("duplicateDetection")}
              className="secondary-action"
              type="button"
              disabled={isDetectingDuplicates}
              aria-busy={isDetectingDuplicates}
              title={isDetectingDuplicates ? t("duplicateDetecting") : t("duplicateDetection")}
              onClick={() => void runDuplicateDetection()}
            >
              <Copy size={16} aria-hidden="true" />
              <span>{isDetectingDuplicates ? t("detecting") : t("duplicateShort")}</span>
            </button>
            <button
              aria-label={isSyncing ? t("syncing") : t("syncLibrary")}
              className="secondary-action"
              type="button"
              disabled={isSyncing}
              aria-busy={isSyncing}
              title={isSyncing ? t("syncing") : t("syncLibrary")}
              onClick={() => void syncLibrary()}
            >
              <RotateCw size={16} aria-hidden="true" />
              <span>{isSyncing ? t("syncing") : t("syncShort")}</span>
            </button>
            <button
              aria-label={isImporting ? t("cancelImport") : t("importFolder")}
              className="primary-action"
              type="button"
              aria-busy={isImporting}
              title={isImporting ? t("cancelImport") : t("importFolder")}
              onClick={isImporting ? cancelImport : handleChooseImportFolder}
            >
              <FolderPlus size={16} aria-hidden="true" />
              <span>{isImporting ? t("cancel") : t("importAction")}</span>
            </button>
          </header>
        ) : null}

        <section className="content">
          {shouldShowLibraryToolbar && isAdvancedSearchOpen ? (
            <section className="advanced-search" aria-label={t("advancedSearch")}>
              <header className="advanced-search-header">
                <div>
                  <strong>{t("advancedSearch")}</strong>
                  <p>{t("advancedSearchHint")}</p>
                </div>
                <div className="advanced-search-actions">
                  <button className="primary-action" type="button" onClick={() => void performSearch()}>
                    {t("applyFilters")}
                  </button>
                  <button className="secondary-action" type="button" onClick={resetSearchFilters}>
                    {t("reset")}
                  </button>
                </div>
              </header>

              <div className="advanced-search-grid">
                <div className="filter-section">
                  <h2>{t("commonFilters")}</h2>
                  <div className="filter-field" role="group" aria-label={t("format")}>
                    <span>{t("format")}</span>
                    <div className="format-chip-grid">
                      {SEARCH_FORMATS.map((format) => {
                        const isActive = searchFormats.includes(format);
                        return (
                          <button
                            aria-pressed={isActive}
                            className={isActive ? "active" : ""}
                            key={format}
                            type="button"
                            onClick={() =>
                              setSearchFormats((current) =>
                                current.includes(format)
                                  ? current.filter((item) => item !== format)
                                  : [...current, format],
                              )
                            }
                          >
                            {format.toUpperCase()}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                  <label>
                    <span>{t("tagsLabel")}</span>
                    <select
                      multiple
                      className="compact-multi-select"
                      aria-label={t("tagsLabel")}
                      value={searchTagIds}
                      onChange={(event) =>
                        setSearchTagIds(
                          Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                        )
                      }
                    >
                      {tags.length > 0 ? (
                        tags.map((tag) => (
                          <option key={tag.id} value={tag.id}>
                            {tag.name}
                          </option>
                        ))
                      ) : (
                        <option disabled value="">
                          {t("noTags")}
                        </option>
                      )}
                    </select>
                  </label>
                  <label>
                    <span>{t("favorite")}</span>
                    <select
                      aria-label={t("favoriteState")}
                      value={searchFavorite}
                      onChange={(event) => setSearchFavorite(event.target.value)}
                    >
                      <option value="any">{t("any")}</option>
                      <option value="favorite">{t("favorited")}</option>
                      <option value="plain">{t("notFavorited")}</option>
                    </select>
                  </label>
                </div>

                <div className="filter-section filter-section-wide">
                  <h2>{t("imageAttributeFilters")}</h2>
                  <div className="filter-field-grid">
                    <label>
                      <span>{t("width")}</span>
                      <div className="range-inputs">
                        <input
                          aria-label={t("minWidth")}
                          inputMode="numeric"
                          placeholder={`${t("minPlaceholder")} px`}
                          value={searchMinWidth}
                          onChange={(event) => setSearchMinWidth(event.target.value)}
                        />
                        <input
                          aria-label={t("maxWidth")}
                          inputMode="numeric"
                          placeholder={`${t("maxPlaceholder")} px`}
                          value={searchMaxWidth}
                          onChange={(event) => setSearchMaxWidth(event.target.value)}
                        />
                      </div>
                    </label>
                    <label>
                      <span>{t("height")}</span>
                      <div className="range-inputs">
                        <input
                          aria-label={t("minHeight")}
                          inputMode="numeric"
                          placeholder={`${t("minPlaceholder")} px`}
                          value={searchMinHeight}
                          onChange={(event) => setSearchMinHeight(event.target.value)}
                        />
                        <input
                          aria-label={t("maxHeight")}
                          inputMode="numeric"
                          placeholder={`${t("maxPlaceholder")} px`}
                          value={searchMaxHeight}
                          onChange={(event) => setSearchMaxHeight(event.target.value)}
                        />
                      </div>
                    </label>
                    <label>
                      <span>{t("sizeMb")}</span>
                      <div className="range-inputs">
                        <input
                          aria-label={t("minSize")}
                          inputMode="decimal"
                          placeholder={`${t("minPlaceholder")} MB`}
                          value={searchMinSizeMb}
                          onChange={(event) => setSearchMinSizeMb(event.target.value)}
                        />
                        <input
                          aria-label={t("maxSize")}
                          inputMode="decimal"
                          placeholder={`${t("maxPlaceholder")} MB`}
                          value={searchMaxSizeMb}
                          onChange={(event) => setSearchMaxSizeMb(event.target.value)}
                        />
                      </div>
                    </label>
                    <label>
                      <span>{t("rating")}</span>
                      <div className="range-inputs">
                        <input
                          aria-label={t("minRating")}
                          inputMode="numeric"
                          placeholder="0"
                          value={searchMinRating}
                          onChange={(event) => setSearchMinRating(event.target.value)}
                        />
                        <input
                          aria-label={t("maxRating")}
                          inputMode="numeric"
                          placeholder="5"
                          value={searchMaxRating}
                          onChange={(event) => setSearchMaxRating(event.target.value)}
                        />
                      </div>
                    </label>
                  </div>
                </div>

                <div className="filter-section">
                  <h2>{t("timeFilters")}</h2>
                  <label>
                    <span>{t("date")}</span>
                    <div className="date-range-inputs">
                      <input
                        aria-label={t("startDate")}
                        type="date"
                        value={searchDateFrom}
                        onChange={(event) => setSearchDateFrom(event.target.value)}
                      />
                      <input
                        aria-label={t("endDate")}
                        type="date"
                        value={searchDateTo}
                        onChange={(event) => setSearchDateTo(event.target.value)}
                      />
                    </div>
                  </label>
                </div>
              </div>
            </section>
          ) : null}

          {shouldShowLibraryToolbar && searchResults ? (
            <section className="search-results" aria-label={t("searchResults")}>
              <header>
                <strong>{t("searchResults")}</strong>
                <button
                  aria-label={t("closeSearchResults")}
                  className="icon-button compact"
                  title={t("closeSearchResults")}
                  type="button"
                  onClick={clearSearchResults}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
              <div className="search-result-groups">
                <SearchResultGroup
                  title={t("collections")}
                  emptyText={t("noCollections")}
                  items={searchResults.collections.map((collection) => ({
                    id: collection.id,
                    title: collection.name,
                    meta: displayCollectionPath(collection),
                    onClick: () => openSearchCollection(collection),
                  }))}
                />
                <SearchResultGroup
                  title={t("images")}
                  emptyText={t("noImages")}
                  items={searchResults.images.map((image) => ({
                    id: image.id,
                    title: image.fileName,
                    meta: displayImagePath(image),
                    onClick: () => openSearchImage(image),
                  }))}
                />
                <SearchResultGroup
                  title={t("tagsLabel")}
                  emptyText={t("noTags")}
                  items={searchResults.tags.map((tag) => ({
                    id: tag.id,
                    title: tag.name,
                    meta: tag.color,
                    onClick: () => openSearchTag(tag),
                  }))}
                />
              </div>
            </section>
          ) : null}

          {shouldShowLibraryToolbar && duplicateResult ? (
            <section className="duplicate-results" aria-label={t("duplicateResults")}>
              <header>
                <strong>
                  {t("duplicateSummary", {
                    hashed: duplicateResult.hashedCount,
                    scanned: duplicateResult.scannedCount,
                  })}
                </strong>
                <button
                  aria-label={t("closeDuplicateResults")}
                  className="icon-button compact"
                  title={t("closeDuplicateResults")}
                  type="button"
                  onClick={() => setDuplicateResult(null)}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
              <div className="duplicate-groups">
                {[...duplicateResult.exactGroups, ...duplicateResult.similarGroups].length > 0 ? (
                  [...duplicateResult.exactGroups, ...duplicateResult.similarGroups].map((group) => (
                    <DuplicateGroupCard
                      group={group}
                      key={group.id}
                      onDelete={() => void deleteDuplicateRemainders(group)}
                      onOpen={(image) => openSearchImage(image)}
                      t={t}
                    />
                  ))
                ) : (
                  <p>{t("noDuplicateImages")}</p>
                )}
              </div>
            </section>
          ) : null}

          {selectedCollection ? (
            <>
              <div className="section-heading detail-heading">
                <button
                  aria-label={t("backToCollections")}
                  className="icon-button"
                  title={t("backToCollections")}
                  type="button"
                  onClick={() => setSelectedCollectionId(null)}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <h1>{selectedCollection.name}</h1>
                <div className="detail-actions">
                  <span>
                    {selectedTagFilterId === "all"
                      ? t("statusImageCount", { count: images.length })
                      : `${visibleImages.length}/${t("statusImageCount", { count: images.length })}`}
                  </span>
                  <button
                    aria-label={
                      selectedCollection.isFavorite
                        ? t("unfavoriteCollection")
                        : t("favoriteCollection")
                    }
                    className="icon-button"
                    title={
                      selectedCollection.isFavorite
                        ? t("unfavoriteCollection")
                        : t("favoriteCollection")
                    }
                    type="button"
                    onClick={() => void toggleCollectionFavorite(selectedCollection)}
                  >
                    <Star
                      size={16}
                      aria-hidden="true"
                      fill={selectedCollection.isFavorite ? "currentColor" : "none"}
                    />
                  </button>
                  <button
                    aria-label={t("setCollectionTags")}
                    className="icon-button"
                    title={t("setCollectionTags")}
                    type="button"
                    onClick={() => void assignTagsToCollection(selectedCollection)}
                  >
                    <TagIcon size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label={t("editCollection")}
                    className="icon-button"
                    title={t("editCollection")}
                    type="button"
                    onClick={() => openCollectionEditor(selectedCollection)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label={t("deleteCollectionRecord")}
                    className="icon-button danger"
                    title={t("deleteCollectionRecord")}
                    type="button"
                    onClick={() => void deleteCollectionRecord(selectedCollection)}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="detail-meta">
                <span>{displayCollectionPath(selectedCollection)}</span>
                <button
                  aria-label={t("openLocation")}
                  className="icon-button"
                  title={t("openLocation")}
                  type="button"
                  onClick={() => void openPath(selectedCollection.path)}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="detail-filter-controls">
                <select
                  aria-label={t("imageTagFilter")}
                  value={selectedTagFilterId}
                  onChange={(event) => setSelectedTagFilterId(event.target.value)}
                >
                  <option value="all">{t("allTags")}</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
                <div className="segmented-control" aria-label={t("imageView")}>
                  <button
                    aria-label={t("imageListView")}
                    className={imageViewMode === "list" ? "active" : ""}
                    title={t("listView")}
                    type="button"
                    onClick={() => setImageViewMode("list")}
                  >
                    <List size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label={t("imageGridView")}
                    className={imageViewMode === "grid" ? "active" : ""}
                    title={t("gridView")}
                    type="button"
                    onClick={() => setImageViewMode("grid")}
                  >
                    <Grid2X2 size={16} aria-hidden="true" />
                  </button>
                </div>
                <div className="selection-controls" aria-label={t("imageSelectionActions")}>
                  <button
                    disabled={visibleImages.length === 0}
                    type="button"
                    onClick={toggleVisibleImageSelection}
                  >
                    <Images size={15} aria-hidden="true" />
                    <span>
                      {allVisibleImagesSelected
                        ? t("clearVisibleSelection")
                        : t("selectVisibleImages")}
                    </span>
                  </button>
                  {selectedImages.length > 0 ? (
                    <button type="button" onClick={clearImageSelection}>
                      <X size={15} aria-hidden="true" />
                      <span>{t("clearSelection")}</span>
                    </button>
                  ) : null}
                </div>
              </div>

              {selectedCollectionTags.length > 0 ? (
                <div className="tag-strip" aria-label={t("collectionTags")}>
                  {selectedCollectionTags.map((tag) => (
                    <span className="tag-chip" key={tag.id} style={tagChipStyle(tag)}>
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {selectedImages.length > 0 ? (
                <div className="batch-toolbar" aria-label={t("batchImageActions")}>
                  <strong>{t("selectedImageCount", { count: selectedImages.length })}</strong>
                  <div className="batch-toolbar-actions">
                    <button type="button" onClick={() => void batchMoveImages()}>
                      <MoveRight size={15} aria-hidden="true" />
                      <span>{t("move")}</span>
                    </button>
                    <button type="button" onClick={() => void batchCopyImages()}>
                      <Copy size={15} aria-hidden="true" />
                      <span>{t("copy")}</span>
                    </button>
                    <button type="button" onClick={() => void batchCopyImagePaths()}>
                      <Copy size={15} aria-hidden="true" />
                      <span>{t("copyPaths")}</span>
                    </button>
                    <button type="button" onClick={() => void batchSetImageTags()}>
                      <TagIcon size={15} aria-hidden="true" />
                      <span>{t("tag")}</span>
                    </button>
                    <button type="button" onClick={() => void batchRateImages()}>
                      <Star size={15} aria-hidden="true" />
                      <span>{t("rating")}</span>
                    </button>
                    <button type="button" onClick={() => void batchSetImageFavorite(true)}>
                      <Star size={15} aria-hidden="true" fill="currentColor" />
                      <span>{t("favoriteImages")}</span>
                    </button>
                    <button type="button" onClick={() => void batchSetImageFavorite(false)}>
                      <Star size={15} aria-hidden="true" />
                      <span>{t("unfavoriteImages")}</span>
                    </button>
                    <button
                      className="danger"
                      type="button"
                      onClick={() => void batchDeleteImages()}
                    >
                      <Trash2 size={15} aria-hidden="true" />
                      <span>{t("delete")}</span>
                    </button>
                  </div>
                </div>
              ) : null}

              {collectionDropTargets.length > 0 &&
              (selectedImages.length > 0 || draggedImageIds.length > 0) ? (
                <div className="collection-drop-strip" aria-label={t("imageMoveTargets")}>
                  {collectionDropTargets.map((collection) => (
                    <button
                      aria-label={t("moveToCollection", { name: collection.name })}
                      className={`collection-drop-target ${
                        dragOverCollectionId === collection.id ? "over" : ""
                      }`}
                      key={collection.id}
                      type="button"
                      onClick={() => {
                        if (selectedImages.length > 0) {
                          void moveImagesToCollection(selectedImages, collection);
                        }
                      }}
                      onDragEnter={() => setDragOverCollectionId(collection.id)}
                      onDragLeave={() => setDragOverCollectionId(null)}
                      onDragOver={(event) => handleCollectionDragOver(event, collection.id)}
                      onDrop={(event) => void dropImagesOnCollection(event, collection)}
                    >
                      <Images size={16} aria-hidden="true" />
                      <span>{collection.name}</span>
                      <small>{t("collectionImageCount", { count: collection.imageCount })}</small>
                    </button>
                  ))}
                </div>
              ) : null}

              <section
                className={`image-surface ${imageViewMode}`}
                ref={imageListRef}
                aria-busy={imagesLoading}
              >
                {imagesLoading ? (
                  <div className="empty-state">
                    <h2>{t("loading")}</h2>
                    <p>{t("readingImageIndex")}</p>
                  </div>
                ) : visibleImages.length > 0 ? (
                  imageViewMode === "list" ? (
                  <div
                    className="image-virtual-space"
                    style={{ height: `${imageVirtualizer.getTotalSize()}px` }}
                  >
                    {imageVirtualizer.getVirtualItems().map((virtualItem) => {
                      const image = visibleImages[virtualItem.index];

                      return (
                        <article
                          aria-selected={selectedImageIds.has(image.id)}
                          className={`image-row ${
                            selectedImageIds.has(image.id) ? "selected" : ""
                          }`}
                          draggable
                          key={image.id}
                          role="button"
                          tabIndex={0}
                          style={{ transform: `translateY(${virtualItem.start}px)` }}
                          onContextMenu={(event) => {
                            event.preventDefault();
                            if (!selectedImageIds.has(image.id)) {
                              setSelectedImageIds(new Set([image.id]));
                            }
                            setImageContextMenu({
                              imageId: image.id,
                              x: event.clientX,
                              y: event.clientY,
                            });
                          }}
                          onDoubleClick={() => openViewer(virtualItem.index)}
                          onDragEnd={handleImageDragEnd}
                          onDragStart={(event) => handleImageDragStart(event, image)}
                          onKeyDown={(event) => {
                            if (event.key === "Enter") {
                              openViewer(virtualItem.index);
                            }
                          }}
                        >
                          <label
                            className="image-select"
                            onClick={(event) => event.stopPropagation()}
                          >
                            <input
                              aria-label={t("selectImage")}
                              checked={selectedImageIds.has(image.id)}
                              type="checkbox"
                              onChange={() => toggleImageSelection(image.id)}
                            />
                          </label>
                          <div className="image-thumb-placeholder">
                            {thumbnails[image.id] ? (
                              <img
                                alt=""
                                loading="lazy"
                                src={convertFileSrc(thumbnails[image.id].cachePath)}
                              />
                            ) : (
                              <FileImage size={20} aria-hidden="true" />
                            )}
                          </div>
                          <div className="image-row-main">
                            <h2>{image.fileName}</h2>
                            <p>{displayImagePath(image)}</p>
                            {(imageTagMap[image.id] ?? []).length > 0 ? (
                              <div className="tag-chip-row" aria-label={t("imageTags")}>
                                {(imageTagMap[image.id] ?? []).map((tag) => (
                                  <span
                                    className="tag-chip compact"
                                    key={tag.id}
                                    style={tagChipStyle(tag)}
                                  >
                                    {tag.name}
                                  </span>
                                ))}
                              </div>
                            ) : null}
                          </div>
                          <div className="image-row-meta">
                            <span>{image.format}</span>
                            <span>
                              {image.width && image.height
                                ? `${image.width} x ${image.height}`
                                : t("unknownDimensions")}
                            </span>
                            <span>{formatBytes(image.sizeBytes)}</span>
                            <button
                              aria-label={t("setImageTags")}
                              className="icon-button compact secondary-row-action"
                              title={t("setImageTags")}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void assignTagsToImage(image);
                              }}
                            >
                              <TagIcon size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label={t("setAsCover")}
                              className="icon-button compact"
                              title={t("setAsCover")}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void setCollectionCover(image);
                              }}
                            >
                              {selectedCollection.coverImageId === image.id ? (
                                <Star size={14} aria-hidden="true" fill="currentColor" />
                              ) : (
                                <ImagePlus size={14} aria-hidden="true" />
                              )}
                            </button>
                            <button
                              aria-label={t("renameImage")}
                              className="icon-button compact secondary-row-action"
                              title={t("renameImage")}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void renameImage(image);
                              }}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label={t("moveImage")}
                              className="icon-button compact"
                              title={t("moveImage")}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveImage(image);
                              }}
                            >
                              <MoveRight size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label={t("copyImage")}
                              className="icon-button compact secondary-row-action"
                              title={t("copyImage")}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void copyImage(image);
                              }}
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label={t("deleteImage")}
                              className="icon-button compact danger secondary-row-action"
                              title={t("deleteImage")}
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void deleteImage(image);
                              }}
                            >
                              <Trash2 size={14} aria-hidden="true" />
                            </button>
                          </div>
                        </article>
                      );
                    })}
                  </div>
                  ) : (
                    <div
                      className="image-virtual-space image-grid-virtual-space"
                      style={{ height: `${imageVirtualizer.getTotalSize()}px` }}
                    >
                      {imageVirtualizer.getVirtualItems().map((virtualItem) => {
                        const rowStart = virtualItem.index * imageGridColumnCount;
                        const rowImages = visibleImages.slice(
                          rowStart,
                          rowStart + imageGridColumnCount,
                        );

                        return (
                          <div
                            className="image-grid-row"
                            key={virtualItem.key}
                            style={{
                              gridTemplateColumns: `repeat(${imageGridColumnCount}, minmax(0, 1fr))`,
                              transform: `translateY(${virtualItem.start}px)`,
                            }}
                          >
                            {rowImages.map((image, columnIndex) => {
                              const imageIndex = rowStart + columnIndex;
                              return (
                                <article
                                  aria-label={image.fileName}
                                  aria-selected={selectedImageIds.has(image.id)}
                                  className={`image-tile ${
                                    selectedImageIds.has(image.id) ? "selected" : ""
                                  }`}
                                  draggable
                                  key={image.id}
                                  role="button"
                                  tabIndex={0}
                                  onContextMenu={(event) => {
                                    event.preventDefault();
                                    if (!selectedImageIds.has(image.id)) {
                                      setSelectedImageIds(new Set([image.id]));
                                    }
                                    setImageContextMenu({
                                      imageId: image.id,
                                      x: event.clientX,
                                      y: event.clientY,
                                    });
                                  }}
                                  onDoubleClick={() => openViewer(imageIndex)}
                                  onDragEnd={handleImageDragEnd}
                                  onDragStart={(event) => handleImageDragStart(event, image)}
                                  onKeyDown={(event) => {
                                    if (event.key === "Enter") {
                                      openViewer(imageIndex);
                                    }
                                  }}
                                >
                                  <label
                                    className="image-select"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <input
                                      aria-label={t("selectImage")}
                                      checked={selectedImageIds.has(image.id)}
                                      type="checkbox"
                                      onChange={() => toggleImageSelection(image.id)}
                                    />
                                  </label>
                                  <div className="image-tile-thumb">
                                    {thumbnails[image.id] ? (
                                      <img
                                        alt=""
                                        loading="lazy"
                                        src={convertFileSrc(thumbnails[image.id].cachePath)}
                                      />
                                    ) : (
                                      <FileImage size={24} aria-hidden="true" />
                                    )}
                                  </div>
                                  <strong title={image.fileName}>{image.fileName}</strong>
                                </article>
                              );
                            })}
                          </div>
                        );
                      })}
                    </div>
                  )
                ) : (
                  <div className="empty-state">
                    <h2>{images.length > 0 ? t("noMatchingImages") : t("noImagesYet")}</h2>
                    <p>
                      {images.length > 0
                        ? t("adjustTagFilter")
                        : t("reimportCheckPermissions")}
                    </p>
                  </div>
                )}
              </section>
            </>
          ) : activeView === "settings" ? (
            <>
              <div className="section-heading">
                <div>
                  <h1>{t("settings")}</h1>
                  <p className="section-subtitle">{t("settingsSubtitle")}</p>
                </div>
              </div>

              <section className="settings-page" aria-label={t("settings")}>
                <article className="settings-card">
                  <header>
                    <Settings size={18} aria-hidden="true" />
                    <h2>{t("preferences")}</h2>
                  </header>
                  <div className="settings-grid">
                    <label>
                      <span>{t("theme")}</span>
                      <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                        <option value="system">{t("system")}</option>
                        <option value="light">{t("light")}</option>
                        <option value="dark">{t("dark")}</option>
                      </select>
                    </label>
                    <div className="setting-field">
                      <span>{t("language")}</span>
                      <div className="language-segmented" role="group" aria-label={t("language")}>
                        {LANGUAGE_OPTIONS.map((option) => (
                          <button
                            aria-pressed={appLanguage === option.value}
                            className={appLanguage === option.value ? "active" : ""}
                            key={option.value}
                            type="button"
                            onClick={() => void updateLanguagePreference(option.value)}
                          >
                            {t(option.labelKey)}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label>
                      <span>{t("shortcuts")}</span>
                      <select
                        value={shortcutProfile}
                        onChange={(event) => setShortcutProfile(event.target.value)}
                      >
                        <option value="default">{t("defaultShortcut")}</option>
                        <option value="vim">Vim</option>
                        <option value="minimal">{t("minimalShortcut")}</option>
                      </select>
                    </label>
                    <label>
                      <span>{t("thumbnails")}</span>
                      <input
                        aria-label={t("thumbnails")}
                        max={512}
                        min={64}
                        type="number"
                        value={thumbnailSize}
                        onChange={(event) => setThumbnailSize(event.target.value)}
                      />
                    </label>
                  </div>
                  <footer>
                    <button className="primary-action" type="button" onClick={() => void savePreferences()}>
                      {t("savePreferences")}
                    </button>
                  </footer>
                </article>

                <article className="settings-card">
                  <header>
                    <Info size={18} aria-hidden="true" />
                    <h2>{t("dataManagement")}</h2>
                  </header>
                  <div className="settings-section database-storage">
                    <div className="settings-section-heading">
                      <div>
                        <h3>{t("databaseStorage")}</h3>
                        <p>{t("databaseStorageDescription")}</p>
                      </div>
                    </div>
                    <div className="database-path-row">
                      <div>
                        <span>{t("currentDatabasePath")}</span>
                        <output
                          aria-label={t("currentDatabasePath")}
                          className={`database-path-display ${
                            status?.paths.database_path ? "" : "empty"
                          }`}
                          title={status?.paths.database_path ?? t("databasePathDesktopOnly")}
                        >
                          {status?.paths.database_path || t("databasePathDesktopOnly")}
                        </output>
                      </div>
                      <button
                        className="database-path-action"
                        type="button"
                        disabled={
                          isChangingDatabasePath || isImporting || isSyncing || isDetectingDuplicates
                        }
                        onClick={() => void changeDatabaseStoragePath()}
                      >
                        {isChangingDatabasePath ? t("changingDatabasePath") : t("changeDatabasePath")}
                      </button>
                    </div>
                  </div>
                  <div className="settings-section">
                    <div className="settings-section-heading">
                      <div>
                        <h3>{t("dataTools")}</h3>
                      </div>
                    </div>
                    <div className="settings-actions">
                      <button type="button" onClick={() => void runDataTool("backup_database")}>
                        {t("backupDatabase")}
                      </button>
                      <button type="button" onClick={() => void restoreDatabase()}>
                        {t("restoreDatabase")}
                      </button>
                      <button type="button" onClick={() => void runDataTool("rebuild_index")}>
                        {t("rebuildIndex")}
                      </button>
                      <button type="button" onClick={() => void runDataTool("export_library_data")}>
                        {t("exportData")}
                      </button>
                    </div>
                  </div>
                </article>
              </section>
            </>
          ) : activeView === "tags" ? (
            <>
              <div className="section-heading">
                <div>
                  <h1>{t("tagsLabel")}</h1>
                  <p className="section-subtitle">{t("tagCount", { count: tags.length })}</p>
                </div>
              </div>

              <form
                className="tag-editor-panel"
                aria-label={editingTagId ? t("editTag") : t("newTag")}
                onSubmit={(event) => void saveTagDraft(event)}
              >
                <label>
                  <span>{t("tagName")}</span>
                  <input
                    required
                    value={tagDraftName}
                    onChange={(event) => setTagDraftName(event.target.value)}
                  />
                </label>
                <label className="tag-color-field">
                  <span>{t("color")}</span>
                  <input
                    aria-label={t("tagColor")}
                    type="color"
                    value={tagDraftColor}
                    onChange={(event) => setTagDraftColor(event.target.value)}
                  />
                </label>
                <footer>
                  {editingTagId ? (
                    <button className="secondary-action" type="button" onClick={resetTagDraft}>
                      {t("cancelEdit")}
                    </button>
                  ) : null}
                  <button className="primary-action" disabled={isTagSaving} type="submit">
                    {isTagSaving ? t("saving") : editingTagId ? t("saveTag") : t("addTag")}
                  </button>
                </footer>
              </form>

              <section className="tag-gallery" aria-label={t("tagsLabel")}>
                {tags.length > 0 ? (
                  tags.map((tag) => (
                    <article className="tag-card" key={tag.id}>
                      <button
                        className="tag-card-main"
                        type="button"
                        onClick={() => openSearchTag(tag)}
                      >
                        <span className="tag-dot" style={{ background: tag.color }} />
                        <strong>{tag.name}</strong>
                        <small>{tag.color}</small>
                      </button>
                      <div className="tag-card-actions">
                        <button
                          aria-label={`${t("editTag")} ${tag.name}`}
                          className="icon-button compact"
                          title={t("editTag")}
                          type="button"
                          onClick={() => startEditTag(tag)}
                        >
                          <Pencil size={14} aria-hidden="true" />
                        </button>
                        <button
                          aria-label={`${t("delete")} ${tag.name}`}
                          className="icon-button compact danger"
                          title={t("delete")}
                          type="button"
                          onClick={() => void deleteTagRecord(tag)}
                        >
                          <Trash2 size={14} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <h2>{t("noTagsYet")}</h2>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="section-heading">
                <h1>{collectionViewTitle(activeView, selectedTagFilterId, tags, t)}</h1>
                <span>
                  {status
                    ? t("collectionCountStatus", {
                        rendered: renderedCollections.length,
                        visible: visibleCollections.length,
                        total: status.collection_count,
                      })
                    : t("initializing")}
                </span>
              </div>

              <div className="collection-controls">
                <div className="collection-filter-controls">
                  <select
                    aria-label={t("collectionSort")}
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as CollectionSortKey)}
                  >
                    <option value="imported">{t("recentImport")}</option>
                    <option value="name">{t("name")}</option>
                    <option value="images">{t("imageCount")}</option>
                    <option value="size">{t("storageSize")}</option>
                  </select>
                  <select
                    aria-label={t("tagFilter")}
                    value={selectedTagFilterId}
                    onChange={(event) => setSelectedTagFilterId(event.target.value)}
                  >
                    <option value="all">{t("allTags")}</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="collection-view-controls">
                  <div className="segmented-control" aria-label={t("collectionView")}>
                    <button
                      aria-label={t("gridView")}
                      className={viewMode === "grid" ? "active" : ""}
                      title={t("gridView")}
                      type="button"
                      onClick={() => setViewMode("grid")}
                    >
                      <Grid2X2 size={16} aria-hidden="true" />
                    </button>
                    <button
                      aria-label={t("listView")}
                      className={viewMode === "list" ? "active" : ""}
                      title={t("listView")}
                      type="button"
                      onClick={() => setViewMode("list")}
                    >
                      <List size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              <section
                className={`collection-surface ${viewMode}`}
                aria-busy={collectionsLoading}
                onScroll={handleCollectionSurfaceScroll}
              >
                {collectionsLoading ? (
                  <div className="empty-state">
                    <h2>{t("loading")}</h2>
                    <p>{t("readingCollectionIndex")}</p>
                  </div>
                ) : visibleCollections.length > 0 ? (
                  <>
                    {renderedCollections.map((collection) => (
                      <article
                        className="collection-card"
                        key={collection.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => openCollection(collection)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            openCollection(collection);
                          }
                        }}
                      >
                        <div className="collection-cover">
                          {collectionCovers[collection.id] ? (
                            <img
                              alt=""
                              src={convertFileSrc(collectionCovers[collection.id].cachePath)}
                            />
                          ) : (
                            <Images size={24} aria-hidden="true" />
                          )}
                        </div>
                        <div className="collection-main">
                          <div className="collection-title-row">
                            <h2>{collection.name}</h2>
                            {collection.isFavorite ? <Star size={15} aria-label={t("favorited")} /> : null}
                          </div>
                          <p>{displayCollectionPath(collection)}</p>
                          {(collectionTagMap[collection.id] ?? []).length > 0 ? (
                            <div className="tag-chip-row" aria-label={t("collectionTags")}>
                              {(collectionTagMap[collection.id] ?? []).map((tag) => (
                                <span
                                  className="tag-chip compact"
                                  key={tag.id}
                                  style={tagChipStyle(tag)}
                                >
                                  {tag.name}
                                </span>
                              ))}
                            </div>
                          ) : null}
                          <div className="collection-meta">
                            <span>{t("collectionImageCount", { count: collection.imageCount })}</span>
                            <span>{formatBytes(collection.totalSizeBytes)}</span>
                            <span>{formatDate(collection.importedAt, appLanguage)}</span>
                            <span>{t("collectionRating", { rating: collection.rating })}</span>
                          </div>
                        </div>
                        <div className="collection-actions">
                          <button
                            aria-label={
                              collection.isFavorite
                                ? t("unfavoriteCollection")
                                : t("favoriteCollection")
                            }
                            className="icon-button"
                            title={
                              collection.isFavorite
                                ? t("unfavoriteCollection")
                                : t("favoriteCollection")
                            }
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void toggleCollectionFavorite(collection);
                            }}
                          >
                            <Star
                              size={16}
                              aria-hidden="true"
                              fill={collection.isFavorite ? "currentColor" : "none"}
                            />
                          </button>
                          <button
                            aria-label={t("setCollectionTags")}
                            className="icon-button secondary-card-action"
                            title={t("setCollectionTags")}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void assignTagsToCollection(collection);
                            }}
                          >
                            <TagIcon size={16} aria-hidden="true" />
                          </button>
                          <button
                            aria-label={t("copiedPath")}
                            className="icon-button secondary-card-action"
                            title={t("copiedPath")}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void copyPath(collection.path);
                            }}
                          >
                            <Copy size={16} aria-hidden="true" />
                          </button>
                          <button
                            aria-label={t("openLocation")}
                            className="icon-button secondary-card-action"
                            title={t("openLocation")}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void openPath(collection.path);
                            }}
                          >
                            <ExternalLink size={16} aria-hidden="true" />
                          </button>
                          <button
                            aria-label={t("deleteCollectionRecord")}
                            className="icon-button danger secondary-card-action"
                            title={t("deleteCollectionRecord")}
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              void deleteCollectionRecord(collection);
                            }}
                          >
                            <Trash2 size={16} aria-hidden="true" />
                          </button>
                        </div>
                      </article>
                    ))}
                    {hasMoreCollections ? (
                      <button className="load-more-collections" type="button" onClick={loadMoreCollections}>
                        {t("loadMoreCollections")}
                      </button>
                    ) : null}
                  </>
                ) : (
                  <div className="empty-state">
                    <h2>{collections.length > 0 ? t("noMatchingCollections") : t("noCollectionsYet")}</h2>
                    <p>
                      {collections.length > 0
                        ? t("adjustSearchKeywords")
                        : t("importFolderEmptyDescription")}
                    </p>
                    {collections.length === 0 ? (
                      <button
                        className="primary-action"
                        type="button"
                        disabled={isImporting}
                        onClick={handleChooseImportFolder}
                      >
                        <FolderPlus size={16} aria-hidden="true" />
                        <span>{isImporting ? t("importing") : t("importFolder")}</span>
                      </button>
                    ) : null}
                  </div>
                )}
              </section>
            </>
          )}

          {selectedImportPath ? (
            <div className="selected-folder" aria-label={t("selectedImportFolder")}>
              <span>{selectedImportPath}</span>
              <div className="selected-folder-actions">
                <button
                  aria-label={t("copiedPath")}
                  className="icon-button"
                  title={t("copiedPath")}
                  type="button"
                  onClick={handleCopyPath}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label={t("openLocation")}
                  className="icon-button"
                  title={t("openLocation")}
                  type="button"
                  onClick={handleOpenPath}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : null}

          {importProgress ? (
            <div className="import-progress" aria-label={t("importProgress")}>
              <div>
                <strong>{importProgressPhaseText(importProgress.phase, t)}</strong>
                <span>
                  {importProgress.processedCount}/{importProgress.totalCount}{" "}
                  {importProgressUnit(importProgress.phase, t)} ·{" "}
                  {t("generatedCollections", { count: importProgress.collectionCount })}
                </span>
              </div>
              <progress
                max={Math.max(importProgress.totalCount, 1)}
                value={Math.min(importProgress.processedCount, Math.max(importProgress.totalCount, 1))}
              />
              <small title={importProgress.currentPath}>{importProgress.currentName}</small>
            </div>
          ) : null}

          <footer className="status-bar">
            {error ? (
              <span className="status-error">{error}</span>
            ) : notice ? (
              <span className="status-notice">{notice}</span>
            ) : status ? (
              <>
                <span>
                  Schema v{status.schema_version}/{status.current_schema_version}
                </span>
                <span>{t("statusImageCount", { count: status.image_count })}</span>
                <span>{t("statusTagCount", { count: status.tag_count })}</span>
              </>
            ) : (
              <span>{t("importingDatabase")}</span>
            )}
          </footer>
        </section>
      </section>

      {imageContextMenu && contextImage ? (
        <div
          className="context-menu"
          style={{ left: imageContextMenu.x, top: imageContextMenu.y }}
          role="menu"
          onClick={(event) => event.stopPropagation()}
        >
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              openViewer(visibleImages.indexOf(contextImage));
            }}
          >
            {t("open")}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void renameImage(contextImage);
            }}
          >
            {t("rename")}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void moveImage(contextImage);
            }}
          >
            {t("move")}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void copyImage(contextImage);
            }}
          >
            {t("copy")}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void assignTagsToImage(contextImage);
            }}
          >
            {t("tag")}
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              setNotice(
                `${contextImage.fileName} · ${contextImage.format} · ${formatBytes(
                  contextImage.sizeBytes,
                )}`,
              );
            }}
          >
            {t("info")}
          </button>
          <button
            className="danger"
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void deleteImage(contextImage);
            }}
          >
            {t("delete")}
          </button>
        </div>
      ) : null}

      {isCollectionEditorOpen && selectedCollection ? (
        <section className="modal-backdrop" role="presentation">
          <form
            aria-label={t("editCollection")}
            className="collection-editor"
            onSubmit={(event) => void saveCollectionEditor(event)}
          >
            <header>
              <h2>{t("editCollection")}</h2>
              <button
                aria-label={t("closeEdit")}
                className="icon-button"
                title={t("closeEdit")}
                type="button"
                onClick={() => setIsCollectionEditorOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <label>
              <span>{t("name")}</span>
              <input
                required
                value={collectionDraft.name}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    name: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>{t("description")}</span>
              <textarea
                rows={4}
                value={collectionDraft.description}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    description: event.target.value,
                  }))
                }
              />
            </label>

            <label>
              <span>{t("rating")}</span>
              <input
                max={5}
                min={0}
                type="number"
                value={collectionDraft.rating}
                onChange={(event) =>
                  setCollectionDraft((current) => ({
                    ...current,
                    rating: Number(event.target.value),
                  }))
                }
              />
            </label>

            <footer>
              <button
                className="secondary-action"
                type="button"
                onClick={() => setIsCollectionEditorOpen(false)}
              >
                {t("cancel")}
              </button>
              <button className="primary-action" disabled={isCollectionSaving} type="submit">
                {isCollectionSaving ? t("saving") : t("save")}
              </button>
            </footer>
          </form>
        </section>
      ) : null}

      {tagAssignmentTarget ? (
        <section className="modal-backdrop" role="presentation">
          <form
            aria-label={t("setTags")}
            className="tag-assignment-modal"
            onSubmit={(event) => void saveTagAssignment(event)}
          >
            <header>
              <h2>{tagAssignmentTitle}</h2>
              <button
                aria-label={t("closeTagSettings")}
                className="icon-button"
                title={t("closeTagSettings")}
                type="button"
                onClick={() => {
                  setTagAssignmentTarget(null);
                  setTagAssignmentMode("replace");
                  setTagAssignmentIds([]);
                  setIsTagAssignmentMenuOpen(false);
                }}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            {tagAssignmentTarget.kind === "batch" ? (
              <div className="tag-mode-control" role="group" aria-label={t("tagAssignmentMode")}>
                {(
                  [
                    ["add", "addTags"],
                    ["remove", "removeTags"],
                    ["replace", "replaceTags"],
                  ] as const
                ).map(([mode, labelKey]) => (
                  <button
                    aria-pressed={tagAssignmentMode === mode}
                    className={tagAssignmentMode === mode ? "active" : ""}
                    key={mode}
                    type="button"
                    onClick={() => setTagAssignmentMode(mode)}
                  >
                    {t(labelKey)}
                  </button>
                ))}
              </div>
            ) : null}

            <div className="tag-assignment-field">
              <span>{t("tagsLabel")}</span>
              <button
                aria-label={t("setTags")}
                aria-expanded={isTagAssignmentMenuOpen}
                className="tag-assignment-trigger"
                type="button"
                onClick={() => setIsTagAssignmentMenuOpen((current) => !current)}
              >
                {tagAssignmentIds.length > 0
                  ? t("selectedTagsCount", { count: tagAssignmentIds.length })
                  : t("selectTags")}
              </button>
              {isTagAssignmentMenuOpen ? (
                <div className="tag-assignment-menu" role="group" aria-label={t("tagOptions")}>
                  {tags.map((tag) => (
                    <label key={tag.id}>
                      <input
                        checked={tagAssignmentIds.includes(tag.id)}
                        type="checkbox"
                        onChange={(event) => {
                          const checked = event.currentTarget.checked;
                          setTagAssignmentIds((current) =>
                            checked
                              ? [...current, tag.id]
                              : current.filter((id) => id !== tag.id),
                          );
                        }}
                      />
                      <span className="tag-dot" style={{ background: tag.color }} />
                      <strong>{tag.name}</strong>
                    </label>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="tag-assignment-preview" aria-label={t("selectedTags")}>
              {tagAssignmentIds.length > 0 ? (
                tagAssignmentIds
                  .map((id) => tags.find((tag) => tag.id === id))
                  .filter((tag): tag is PhotoTag => Boolean(tag))
                  .map((tag) => (
                    <span className="tag-chip compact" key={tag.id} style={tagChipStyle(tag)}>
                      {tag.name}
                    </span>
                  ))
              ) : (
                <small>{t("noTagsSelected")}</small>
              )}
            </div>

            <footer>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setTagAssignmentIds([]);
                  setIsTagAssignmentMenuOpen(false);
                }}
              >
                {t("clear")}
              </button>
              <button
                className="secondary-action"
                type="button"
                onClick={() => {
                  setTagAssignmentTarget(null);
                  setTagAssignmentMode("replace");
                  setTagAssignmentIds([]);
                  setIsTagAssignmentMenuOpen(false);
                }}
              >
                {t("cancel")}
              </button>
              <button className="primary-action" disabled={isTagAssignmentSaving} type="submit">
                {isTagAssignmentSaving ? t("saving") : t("saveTag")}
              </button>
            </footer>
          </form>
        </section>
      ) : null}

      {activeImage ? (
        <section
          aria-label={t("imageViewer")}
          aria-modal="true"
          className="viewer-overlay"
          ref={viewerRef}
          role="dialog"
        >
          <header className="viewer-toolbar">
            <div className="viewer-title">
              <strong>{activeImage.fileName}</strong>
              <span>
                {(viewerIndex ?? 0) + 1}/{visibleImages.length}
              </span>
            </div>
            <div className="viewer-controls" aria-label={t("viewerToolbar")}>
              <button type="button" onClick={() => resetViewerTransform("fit")}>
                {t("fit")}
              </button>
              <button type="button" onClick={() => resetViewerTransform("actual")}>
                1:1
              </button>
              <button aria-label={t("zoomOut")} title={t("zoomOut")} type="button" onClick={() => changeViewerZoom(-0.25)}>
                <ZoomOut size={16} aria-hidden="true" />
              </button>
              <span className="viewer-zoom">{Math.round(viewerZoom * 100)}%</span>
              <button aria-label={t("zoomIn")} title={t("zoomIn")} type="button" onClick={() => changeViewerZoom(0.25)}>
                <ZoomIn size={16} aria-hidden="true" />
              </button>
              <button aria-label={t("rotate90")} title={t("rotate90")} type="button" onClick={rotateViewer}>
                <RotateCw size={16} aria-hidden="true" />
              </button>
              <button aria-label={t("fullscreen")} title={t("fullscreen")} type="button" onClick={() => void toggleFullscreen()}>
                <Maximize2 size={16} aria-hidden="true" />
              </button>
              <button
                aria-label={isSlideshowActive ? t("pauseSlideshow") : t("startSlideshow")}
                title={isSlideshowActive ? t("pauseSlideshow") : t("startSlideshow")}
                type="button"
                onClick={() => setIsSlideshowActive((current) => !current)}
              >
                {isSlideshowActive ? (
                  <Pause size={16} aria-hidden="true" />
                ) : (
                  <Play size={16} aria-hidden="true" />
                )}
              </button>
              <button
                aria-label={t("imageInfo")}
                title={t("imageInfo")}
                type="button"
                onClick={() => setIsInfoPanelOpen((current) => !current)}
              >
                <Info size={16} aria-hidden="true" />
              </button>
              <button aria-label={t("closeViewer")} title={t("closeViewer")} type="button" onClick={closeViewer}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <button
            aria-label={t("previousImage")}
            className="viewer-nav previous"
            title={t("previousImage")}
            type="button"
            onClick={showPreviousImage}
          >
            <ChevronLeft size={28} aria-hidden="true" />
          </button>

          <div className={`viewer-stage ${isInfoPanelOpen ? "with-info" : ""}`}>
            <div className={`viewer-canvas ${viewerFitMode}`}>
              {viewerImageState === "loading" ? (
                <div className="viewer-placeholder">{t("loadingImage")}</div>
              ) : null}
              {viewerImageState === "error" ? (
                <div className="viewer-placeholder error">{t("imageDecodeFailed")}</div>
              ) : null}
              {viewerImageSrc ? (
                <img
                  alt={activeImage.fileName}
                  className={viewerFitMode === "fit" ? "fit" : "actual"}
                  src={viewerImageSrc}
                  style={{
                    opacity: viewerImageState === "loaded" ? 1 : 0,
                    transform: `rotate(${viewerRotation}deg) scale(${
                      viewerFitMode === "fit" ? 1 : viewerZoom
                    })`,
                  }}
                  onError={() => setViewerImageState("error")}
                  onLoad={() => setViewerImageState("loaded")}
                />
              ) : null}
            </div>

            {isInfoPanelOpen ? (
              <aside className="viewer-info" aria-label={t("imageInfo")}>
                <h2>{t("info")}</h2>
                <dl>
                  <div>
                    <dt>{t("format")}</dt>
                    <dd>{activeImage.format || activeImage.extension || t("unknown")}</dd>
                  </div>
                  <div>
                    <dt>{t("dimensions")}</dt>
                    <dd>
                      {(viewerAsset?.width || activeImage.width) &&
                      (viewerAsset?.height || activeImage.height)
                        ? `${viewerAsset?.width || activeImage.width} x ${
                            viewerAsset?.height || activeImage.height
                          }`
                        : t("unknown")}
                    </dd>
                  </div>
                  <div>
                    <dt>{t("storageSize")}</dt>
                    <dd>{formatBytes(activeImage.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>{t("path")}</dt>
                    <dd title={displayImagePath(activeImage)}>{displayImagePath(activeImage)}</dd>
                  </div>
                </dl>
              </aside>
            ) : null}
          </div>

          <button
            aria-label={t("nextImage")}
            className="viewer-nav next"
            title={t("nextImage")}
            type="button"
            onClick={showNextImage}
          >
            <ChevronRight size={28} aria-hidden="true" />
          </button>
        </section>
      ) : null}
    </main>
  );
}

type SearchResultItem = {
  id: string;
  title: string;
  meta: string;
  onClick: () => void;
};

function SearchResultGroup({
  title,
  emptyText,
  items,
}: {
  title: string;
  emptyText: string;
  items: SearchResultItem[];
}) {
  return (
    <section className="search-result-group">
      <h2>{title}</h2>
      {items.length > 0 ? (
        <div>
          {items.map((item) => (
            <button key={item.id} type="button" onClick={item.onClick}>
              <span>{item.title}</span>
              <small>{item.meta}</small>
            </button>
          ))}
        </div>
      ) : (
        <p>{emptyText}</p>
      )}
    </section>
  );
}

function DuplicateGroupCard({
  group,
  onDelete,
  onOpen,
  t,
}: {
  group: DuplicateGroup;
  onDelete: () => void;
  onOpen: (image: ImageRecord) => void;
  t: Translator;
}) {
  return (
    <article className="duplicate-group-card">
      <header>
        <span>
          {group.kind === "exact" ? t("exactDuplicate") : t("similarDuplicate", { score: group.score })}
        </span>
        <button className="danger" type="button" onClick={onDelete}>
          {t("deleteRest")}
        </button>
      </header>
      <div>
        {group.images.map((image, index) => (
          <button key={image.id} type="button" onClick={() => onOpen(image)}>
            <span>{index === 0 ? t("keep") : t("candidate")}</span>
            <strong>{image.fileName}</strong>
            <small>{formatBytes(image.sizeBytes)}</small>
          </button>
        ))}
      </div>
      <small>{formatBytes(group.totalSizeBytes)}</small>
    </article>
  );
}

function invokeErrorMessage(value: unknown): string {
  if (typeof value === "object" && value && "message" in value) {
    return String(value.message);
  }

  return String(value);
}

function invokeErrorCode(value: unknown): string | null {
  if (typeof value === "object" && value && "code" in value) {
    return String(value.code);
  }

  return null;
}

function isTauriRuntime(): boolean {
  return "__TAURI_INTERNALS__" in window;
}

function mockStatus(collectionCount: number, imageCount: number): AppStatus {
  return {
    product_name: "PhotoView",
    version: "0.1.0",
    paths: {
      app_data_dir: "",
      database_path: "",
      thumbnails_dir: "",
    },
    schema_version: 1,
    current_schema_version: 1,
    collection_count: collectionCount,
    image_count: imageCount,
    tag_count: 0,
  };
}

function compareCollections(
  left: Collection,
  right: Collection,
  sortKey: CollectionSortKey,
  language: AppLanguage,
): number {
  if (sortKey === "name") {
    return left.name.localeCompare(right.name, language);
  }

  if (sortKey === "images") {
    return right.imageCount - left.imageCount;
  }

  if (sortKey === "size") {
    return right.totalSizeBytes - left.totalSizeBytes;
  }

  return new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime();
}

function collectionViewTitle(
  activeView: NavigationView,
  selectedTagFilterId: string,
  tags: PhotoTag[],
  t: Translator,
): string {
  if (selectedTagFilterId !== "all") {
    const tag = tags.find((item) => item.id === selectedTagFilterId);
    return tag ? t("tagFilterTitle", { name: tag.name }) : t("tagFilterFallback");
  }

  if (activeView === "favorites") {
    return t("favoritesCollections");
  }

  if (activeView === "recent") {
    return t("recentViewed");
  }

  return t("allCollections");
}

function importProgressPhaseText(phase: ImportFolderProgress["phase"], t: Translator): string {
  if (phase === "completed") {
    return t("importDone");
  }

  if (phase === "imported") {
    return t("imported");
  }

  if (phase === "skipped") {
    return t("skipped");
  }

  if (phase === "preparing") {
    return t("preparingImport");
  }

  return t("scanning");
}

function importProgressUnit(_phase: ImportFolderProgress["phase"], t: Translator): string {
  return t("directories");
}

function formatDataToolNotice(
  command: "backup_database" | "rebuild_index" | "export_library_data",
  result: DataFileResult,
  t: Translator,
): string {
  const messageKey =
    command === "backup_database"
      ? "backupCreated"
      : command === "rebuild_index"
        ? "indexRebuilt"
        : "libraryExported";
  const message = t(messageKey);
  return result.path ? `${message}: ${result.path}` : message;
}

function formatBytes(value: number): string {
  if (value < 1024) {
    return `${value} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let size = value / 1024;
  let unitIndex = 0;

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }

  return `${size.toFixed(size >= 10 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatDate(value: string, language: AppLanguage): string {
  return new Intl.DateTimeFormat(language, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function groupTagAssignments(assignments: TagAssignment[]): Record<string, PhotoTag[]> {
  return assignments.reduce<Record<string, PhotoTag[]>>((groups, assignment) => {
    groups[assignment.targetId] = [...(groups[assignment.targetId] ?? []), assignment.tag];
    return groups;
  }, {});
}

function displayCollectionPath(collection: Collection): string {
  return collection.displayPath ?? collection.path;
}

function displayImagePath(image: ImageRecord): string {
  return image.displayPath ?? image.path;
}

function mergeImageTagIds(
  currentTagIds: string[],
  selectedTagIds: string[],
  mode: TagAssignmentMode,
): string[] {
  if (mode === "replace") {
    return [...selectedTagIds];
  }

  if (mode === "remove") {
    const selected = new Set(selectedTagIds);
    return currentTagIds.filter((tagId) => !selected.has(tagId));
  }

  return Array.from(new Set([...currentTagIds, ...selectedTagIds]));
}

function removeDuplicateImages(
  result: DuplicateDetectionResult,
  removedIds: Set<string>,
): DuplicateDetectionResult {
  const filterGroups = (groups: DuplicateGroup[]) =>
    groups
      .map((group) => ({
        ...group,
        images: group.images.filter((image) => !removedIds.has(image.id)),
      }))
      .filter((group) => group.images.length > 1);

  return {
    ...result,
    exactGroups: filterGroups(result.exactGroups),
    similarGroups: filterGroups(result.similarGroups),
  };
}

function tagChipStyle(tag: PhotoTag) {
  return {
    borderColor: tag.color,
    color: tag.color,
  };
}

function appShellStyle(thumbnailSize: string): CSSProperties {
  const gridSize = clamp(Math.round(numberOrNull(thumbnailSize) ?? 192), 64, 512);
  const listSize = clamp(Math.round(gridSize * 0.36), 52, 96);

  return {
    "--thumb-size": `${gridSize}px`,
    "--list-thumb-size": `${listSize}px`,
  } as CSSProperties;
}

function convertImagePath(path: string): string {
  return isTauriRuntime() ? convertFileSrc(path) : path;
}

function omitKey<T>(record: Record<string, T>, key: string): Record<string, T> {
  const next = { ...record };
  delete next[key];
  return next;
}

function omitKeys<T>(record: Record<string, T>, keys: Set<string>): Record<string, T> {
  const next = { ...record };
  for (const key of keys) {
    delete next[key];
  }
  return next;
}

export default App;
