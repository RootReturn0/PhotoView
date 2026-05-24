import {
  type CSSProperties,
  type DragEvent,
  type FormEvent,
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
  Copy,
  ExternalLink,
  FileImage,
  FolderPlus,
  Grid2X2,
  Images,
  ImagePlus,
  Info,
  List,
  Maximize2,
  MoveRight,
  Pause,
  Pencil,
  Play,
  RotateCw,
  Search,
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

type Collection = {
  id: string;
  path: string;
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

type ImageRecord = {
  id: string;
  collectionId: string;
  path: string;
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

type ImageContextMenu = {
  imageId: string;
  x: number;
  y: number;
};

const SEARCH_FORMATS = ["jpg", "png", "gif", "webp", "avif", "svg", "bmp", "tiff", "ico"];

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
  const [imagesLoading, setImagesLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedImportPath, setSelectedImportPath] = useState<string | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [query, setQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResults | null>(null);
  const [isSearching, setIsSearching] = useState(false);
  const [duplicateResult, setDuplicateResult] = useState<DuplicateDetectionResult | null>(null);
  const [isDetectingDuplicates, setIsDetectingDuplicates] = useState(false);
  const [isAdvancedSearchOpen, setIsAdvancedSearchOpen] = useState(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [theme, setTheme] = useState("system");
  const [language, setLanguage] = useState("zh-CN");
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
  const [isCollectionEditorOpen, setIsCollectionEditorOpen] = useState(false);
  const [collectionDraft, setCollectionDraft] = useState<CollectionDraft>({
    name: "",
    description: "",
    rating: 0,
  });
  const [isCollectionSaving, setIsCollectionSaving] = useState(false);
  const [viewerIndex, setViewerIndex] = useState<number | null>(null);
  const [viewerAsset, setViewerAsset] = useState<ViewerImageAsset | null>(null);
  const [viewerFitMode, setViewerFitMode] = useState<ViewerFitMode>("fit");
  const [viewerZoom, setViewerZoom] = useState(1);
  const [viewerRotation, setViewerRotation] = useState(0);
  const [viewerImageState, setViewerImageState] = useState<ImageLoadState>("loading");
  const [isSlideshowActive, setIsSlideshowActive] = useState(false);
  const [isInfoPanelOpen, setIsInfoPanelOpen] = useState(true);
  const importInFlight = useRef(false);
  const thumbnailRequests = useRef(new Set<string>());
  const viewerAssetRequest = useRef(0);
  const pendingImageFocusId = useRef<string | null>(null);
  const imageListRef = useRef<HTMLDivElement | null>(null);
  const viewerRef = useRef<HTMLDivElement | null>(null);

  const selectedCollection = useMemo(
    () => collections.find((collection) => collection.id === selectedCollectionId) ?? null,
    [collections, selectedCollectionId],
  );

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
  const selectedImages = useMemo(
    () => images.filter((image) => selectedImageIds.has(image.id)),
    [images, selectedImageIds],
  );
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

  const visibleCollections = useMemo(() => {
    const normalizedQuery = query.trim().toLocaleLowerCase();
    const textFiltered = normalizedQuery
      ? collections.filter((collection) =>
          [collection.name, collection.path, collection.description]
            .join(" ")
            .toLocaleLowerCase()
            .includes(normalizedQuery),
        )
      : collections;
    const filtered =
      selectedTagFilterId === "all"
        ? textFiltered
        : textFiltered.filter((collection) =>
            (collectionTagMap[collection.id] ?? []).some((tag) => tag.id === selectedTagFilterId),
          );

    return [...filtered].sort((left, right) => compareCollections(left, right, sortKey));
  }, [collectionTagMap, collections, query, selectedTagFilterId, sortKey]);

  const imageVirtualizer = useVirtualizer({
    count: visibleImages.length,
    getScrollElement: () => imageListRef.current,
    estimateSize: () => Math.max(124, Math.round(numberOrNull(thumbnailSize) ?? 192) + 72),
    overscan: 8,
  });

  useEffect(() => {
    void refreshAppData();
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

    const visibleItems = imageVirtualizer.getVirtualItems();
    for (const item of visibleItems) {
      const image = visibleImages[item.index];
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
    if (!isTauriRuntime()) {
      return;
    }

    let unlistenImport: (() => void) | undefined;
    let unlistenSync: (() => void) | undefined;

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
      setNotice("文件夹变更已同步");
    }).then((value) => {
      unlistenSync = value;
    });

    return () => {
      unlistenImport?.();
      unlistenSync?.();
    };
  }, [selectedCollectionId]);

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
      setLanguage(settingValue(nextSettings.language, "zh-CN"));
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
          setNotice("已定位图片");
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
    setIsImporting(true);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中导入文件夹");
      importInFlight.current = false;
      setIsImporting(false);
      return;
    }

    try {
      const folder = await invoke<string | null>("choose_import_folder");
      if (!folder) {
        setIsImporting(false);
        return;
      }

      setSelectedImportPath(folder);
      setNotice("正在导入文件夹");

      const result = await invoke<ImportCollectionResult>("import_collection", {
        request: { path: folder },
      });

      setNotice(
        `${result.collection.name}：扫描 ${result.scannedCount} 张，新增 ${result.insertedCount} 张，更新 ${result.updatedCount} 张，错误 ${result.errorCount} 个`,
      );
      await refreshAppData();
      setSelectedCollectionId(result.collection.id);
    } catch (value) {
      setError(invokeErrorMessage(value));
    } finally {
      importInFlight.current = false;
      setIsImporting(false);
    }
  }

  async function syncLibrary() {
    setError(null);
    setNotice(null);
    setIsSyncing(true);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中同步文件夹");
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
      setNotice("文件夹已同步");
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
      setNotice("请在桌面应用中保存设置");
      return;
    }

    try {
      await Promise.all([
        saveSetting("theme", theme),
        saveSetting("language", language),
        saveSetting("shortcut_profile", shortcutProfile),
        saveSetting("thumbnail_size", thumbnailSize),
      ]);
      setNotice("设置已保存");
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
      setNotice("请在桌面应用中使用数据工具");
      return;
    }

    try {
      const result = await invoke<DataFileResult>(command);
      await refreshAppData();
      setNotice(result.path ? `${result.message}：${result.path}` : result.message);
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function restoreDatabase() {
    const path = window.prompt("备份数据库路径")?.trim();
    if (!path || !window.confirm("恢复会覆盖当前数据库，继续？")) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中恢复数据库");
      return;
    }

    try {
      const result = await invoke<DataFileResult>("restore_database_from_backup", { path });
      await refreshAppData();
      setNotice(result.message);
    } catch (value) {
      setError(invokeErrorMessage(value));
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
      setNotice("请在桌面应用中复制路径");
      return;
    }

    try {
      await invoke("copy_path_to_clipboard", { path });
      setNotice("路径已复制");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function openPath(path: string) {
    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中打开位置");
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
      setNotice("请在桌面应用中搜索");
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
        `搜索完成：${results.collections.length} 个合集，${results.images.length} 张图片，${results.tags.length} 个标签`,
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
    setSelectedTagFilterId(tag.id);
    setNotice(`已筛选标签：${tag.name}`);
  }

  async function runDuplicateDetection() {
    setError(null);
    setNotice(null);
    setIsDetectingDuplicates(true);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中检测重复图片");
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
        `检测完成：扫描 ${result.scannedCount} 张，完全重复 ${result.exactGroups.length} 组，相似 ${result.similarGroups.length} 组`,
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

    if (!window.confirm(`保留第一张，删除其余 ${removableImages.length} 张到回收站？`)) {
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
    setNotice(`已删除 ${removableImages.length - failed.length} 张重复图片`);
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  function openCollection(collection: Collection) {
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
      setNotice("请在桌面应用中编辑合集");
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
      setNotice("合集已保存");
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
      setNotice("请在桌面应用中收藏合集");
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
      setNotice(updated.isFavorite ? "已收藏合集" : "已取消收藏");
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
      setNotice("请在桌面应用中设置封面");
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
      setNotice("封面已更新");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function createTag() {
    const name = window.prompt("标签名称")?.trim();
    if (!name) {
      return;
    }

    const color = window.prompt("标签颜色 #RRGGBB", "#4f7cff")?.trim();
    if (color === undefined) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中创建标签");
      return;
    }

    try {
      await invoke<PhotoTag>("create_tag", {
        request: { name, color: color || null },
      });
      await refreshTags();
      await refreshStatus();
      setNotice("标签已创建");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function editTag() {
    const tag = chooseTag("编辑标签");
    if (!tag) {
      return;
    }

    const name = window.prompt("标签名称", tag.name)?.trim();
    if (!name) {
      return;
    }

    const color = window.prompt("标签颜色 #RRGGBB", tag.color)?.trim();
    if (color === undefined) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中编辑标签");
      return;
    }

    try {
      await invoke<PhotoTag>("update_tag", {
        request: { id: tag.id, name, color: color || tag.color },
      });
      await refreshTags();
      await refreshCollectionTagAssignments();
      if (selectedCollectionId) {
        await refreshImageTagAssignments(selectedCollectionId);
      }
      setNotice("标签已保存");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function deleteTag() {
    const tag = chooseTag("删除标签");
    if (!tag || !window.confirm(`删除标签“${tag.name}”？关联会一并移除。`)) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中删除标签");
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
      setNotice("标签已删除");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function assignTagsToCollection(collection: Collection) {
    const tagIds = chooseTagIds("设置合集标签", collectionTagMap[collection.id] ?? []);
    if (tagIds === null) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中设置合集标签");
      return;
    }

    try {
      const assignedTags = await invoke<PhotoTag[]>("set_collection_tags", {
        request: { targetId: collection.id, tagIds },
      });
      setCollectionTagMap((current) => ({ ...current, [collection.id]: assignedTags }));
      setNotice("合集标签已更新");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function assignTagsToImage(image: ImageRecord) {
    const tagIds = chooseTagIds("设置图片标签", imageTagMap[image.id] ?? []);
    if (tagIds === null) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中设置图片标签");
      return;
    }

    try {
      const assignedTags = await invoke<PhotoTag[]>("set_image_tags", {
        request: { targetId: image.id, tagIds },
      });
      setImageTagMap((current) => ({ ...current, [image.id]: assignedTags }));
      setNotice("图片标签已更新");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function renameImage(image: ImageRecord) {
    const fileName = window.prompt("新的文件名", image.fileName)?.trim();
    if (!fileName || fileName === image.fileName) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中重命名图片");
      return;
    }

    try {
      const updated = await invoke<ImageRecord>("rename_image_file", {
        request: { id: image.id, fileName },
      });
      setImages((current) => current.map((item) => (item.id === image.id ? updated : item)));
      await refreshCollections();
      setNotice("图片已重命名");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  async function moveImage(image: ImageRecord) {
    const target = chooseTargetCollection("移动到合集");
    if (!target) {
      return;
    }

    await moveImagesToCollection([image], target);
  }

  async function copyImage(image: ImageRecord) {
    const target = chooseTargetCollection("复制到合集");
    if (!target) {
      return;
    }

    await copyImagesToCollection([image], target);
  }

  async function deleteImage(image: ImageRecord) {
    if (!window.confirm(`删除图片“${image.fileName}”？默认移到系统回收站。`)) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中删除图片");
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
      setNotice("图片已移到回收站");
    } catch (value) {
      setError(invokeErrorMessage(value));
    }
  }

  function chooseTargetCollection(title: string): Collection | null {
    const candidates = collections.filter((collection) => collection.id !== selectedCollectionId);
    if (candidates.length === 0) {
      setNotice("没有可用目标合集");
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

  function chooseTag(title: string): PhotoTag | null {
    if (tags.length === 0) {
      setNotice("请先创建标签");
      return null;
    }

    const options = tags.map((tag, index) => `${index + 1}. ${tag.name}`).join("\n");
    const value = window.prompt(`${title}\n${options}`)?.trim();
    if (!value) {
      return null;
    }

    const index = Number(value);
    if (Number.isInteger(index) && index >= 1 && index <= tags.length) {
      return tags[index - 1];
    }

    return tags.find((tag) => tag.id === value) ?? null;
  }

  function chooseTagIds(title: string, currentTags: PhotoTag[]): string[] | null {
    if (tags.length === 0) {
      setNotice("请先创建标签");
      return null;
    }

    const options = tags.map((tag, index) => `${index + 1}. ${tag.name}`).join("\n");
    const currentValue = currentTags
      .map((tag) => tags.findIndex((item) => item.id === tag.id) + 1)
      .filter((index) => index > 0)
      .join(", ");
    const value = window.prompt(
      `${title}\n${options}\n输入编号，用逗号分隔；留空清空标签。`,
      currentValue,
    );
    if (value === null) {
      return null;
    }

    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }

    const tagIds: string[] = [];
    for (const token of trimmed.split(/[,，\s]+/).filter(Boolean)) {
      const index = Number(token);
      const tag = Number.isInteger(index) ? tags[index - 1] : tags.find((item) => item.id === token);
      if (!tag) {
        setError(`无效标签：${token}`);
        return null;
      }
      if (!tagIds.includes(tag.id)) {
        tagIds.push(tag.id);
      }
    }

    return tagIds;
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
      setNotice("请在桌面应用中移动图片");
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
    setNotice(`已移动 ${movedIds.length} 张到 ${target.name}`);
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function copyImagesToCollection(imagesToCopy: ImageRecord[], target: Collection) {
    if (imagesToCopy.length === 0) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中复制图片");
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
    setNotice(`已复制 ${copiedCount} 张到 ${target.name}`);
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
    const target = chooseTargetCollection("批量移动到合集");
    if (!target || selectedImages.length === 0) {
      return;
    }

    await moveImagesToCollection(selectedImages, target);
  }

  async function batchCopyImages() {
    const target = chooseTargetCollection("批量复制到合集");
    if (!target || selectedImages.length === 0) {
      return;
    }

    await copyImagesToCollection(selectedImages, target);
  }

  async function batchSetImageTags() {
    if (selectedImages.length === 0) {
      return;
    }

    const tagIds = chooseTagIds("批量设置图片标签", imageTagMap[selectedImages[0].id] ?? []);
    if (tagIds === null) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中批量设置标签");
      return;
    }

    const failed: string[] = [];
    let updatedCount = 0;
    for (const image of selectedImages) {
      try {
        const assignedTags = await invoke<PhotoTag[]>("set_image_tags", {
          request: { targetId: image.id, tagIds },
        });
        setImageTagMap((current) => ({ ...current, [image.id]: assignedTags }));
        updatedCount += 1;
      } catch (value) {
        failed.push(`${image.fileName}: ${invokeErrorMessage(value)}`);
      }
    }

    clearImageSelection();
    setNotice(`已设置 ${updatedCount} 张图片的标签`);
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function batchDeleteImages() {
    if (selectedImages.length === 0) {
      return;
    }

    if (!window.confirm(`删除选中的 ${selectedImages.length} 张图片？默认移到系统回收站。`)) {
      return;
    }

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中批量删除图片");
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
    setNotice(`已删除 ${deletedIds.length} 张图片`);
    setError(failed.length > 0 ? failed.join("；") : null);
  }

  async function batchRateImages() {
    if (selectedImages.length === 0) {
      return;
    }

    const value = window.prompt("评分 0-5", "0")?.trim();
    if (value === undefined || value === null || value === "") {
      return;
    }

    const rating = Number(value);
    if (!Number.isInteger(rating) || rating < 0 || rating > 5) {
      setError("评分必须是 0 到 5 的整数");
      return;
    }

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中批量评分");
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
    setNotice(`已评分 ${selectedImages.length - failed.length} 张图片`);
    setError(failed.length > 0 ? failed.join("；") : null);
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

  async function deleteSelectedCollectionRecord() {
    if (!selectedCollection) {
      return;
    }

    const confirmed = window.confirm(
      `删除合集记录“${selectedCollection.name}”？磁盘文件夹不会被删除。`,
    );
    if (!confirmed) {
      return;
    }

    setError(null);
    setNotice(null);

    if (!isTauriRuntime()) {
      setNotice("请在桌面应用中删除合集记录");
      return;
    }

    try {
      await invoke("delete_collection_record", { id: selectedCollection.id });
      setSelectedCollectionId(null);
      setImages([]);
      setThumbnails({});
      setThumbnailErrors({});
      thumbnailRequests.current.clear();
      setCollections((current) =>
        current.filter((collection) => collection.id !== selectedCollection.id),
      );
      await refreshStatus();
      setNotice("合集记录已删除，磁盘文件夹已保留");
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
    <main className="app-shell" data-theme={theme} style={appShellStyle(thumbnailSize)}>
      <aside className="sidebar" aria-label="PhotoView navigation">
        <div className="brand">
          <span className="brand-mark">PV</span>
          <span>PhotoView</span>
        </div>
        <nav>
          <button className="nav-item active">全部</button>
          <button className="nav-item">收藏</button>
          <button className="nav-item">最近</button>
          <button className="nav-item">标签</button>
        </nav>
      </aside>

      <section className="workspace">
        <header className="toolbar">
          <input
            aria-label="搜索"
            placeholder="搜索合集、路径或描述"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                void performSearch();
              }
            }}
          />
          <button
            className="secondary-action"
            type="button"
            aria-pressed={isAdvancedSearchOpen}
            onClick={() => setIsAdvancedSearchOpen((current) => !current)}
          >
            <SlidersHorizontal size={16} aria-hidden="true" />
            <span>筛选</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isSearching}
            aria-busy={isSearching}
            onClick={() => void performSearch()}
          >
            <Search size={16} aria-hidden="true" />
            <span>{isSearching ? "搜索中" : "搜索"}</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isDetectingDuplicates}
            aria-busy={isDetectingDuplicates}
            onClick={() => void runDuplicateDetection()}
          >
            <Copy size={16} aria-hidden="true" />
            <span>{isDetectingDuplicates ? "检测中" : "重复"}</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            disabled={isSyncing}
            aria-busy={isSyncing}
            onClick={() => void syncLibrary()}
          >
            <RotateCw size={16} aria-hidden="true" />
            <span>{isSyncing ? "同步中" : "同步"}</span>
          </button>
          <button
            className="secondary-action"
            type="button"
            aria-pressed={isSettingsOpen}
            onClick={() => setIsSettingsOpen((current) => !current)}
          >
            <Info size={16} aria-hidden="true" />
            <span>设置</span>
          </button>
          <button
            className="primary-action"
            type="button"
            disabled={isImporting}
            aria-busy={isImporting}
            onClick={handleChooseImportFolder}
          >
            <FolderPlus size={16} aria-hidden="true" />
            <span>{isImporting ? "导入中" : "导入"}</span>
          </button>
        </header>

        <section className="content">
          {isAdvancedSearchOpen ? (
            <section className="advanced-search" aria-label="高级搜索">
              <label>
                <span>格式</span>
                <select
                  multiple
                  aria-label="搜索格式"
                  value={searchFormats}
                  onChange={(event) =>
                    setSearchFormats(
                      Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                    )
                  }
                >
                  {SEARCH_FORMATS.map((format) => (
                    <option key={format} value={format}>
                      {format.toUpperCase()}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>标签</span>
                <select
                  multiple
                  aria-label="搜索标签"
                  value={searchTagIds}
                  onChange={(event) =>
                    setSearchTagIds(
                      Array.from(event.currentTarget.selectedOptions, (option) => option.value),
                    )
                  }
                >
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span>宽度</span>
                <div className="range-inputs">
                  <input
                    aria-label="最小宽度"
                    inputMode="numeric"
                    placeholder="min"
                    value={searchMinWidth}
                    onChange={(event) => setSearchMinWidth(event.target.value)}
                  />
                  <input
                    aria-label="最大宽度"
                    inputMode="numeric"
                    placeholder="max"
                    value={searchMaxWidth}
                    onChange={(event) => setSearchMaxWidth(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>高度</span>
                <div className="range-inputs">
                  <input
                    aria-label="最小高度"
                    inputMode="numeric"
                    placeholder="min"
                    value={searchMinHeight}
                    onChange={(event) => setSearchMinHeight(event.target.value)}
                  />
                  <input
                    aria-label="最大高度"
                    inputMode="numeric"
                    placeholder="max"
                    value={searchMaxHeight}
                    onChange={(event) => setSearchMaxHeight(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>大小 MB</span>
                <div className="range-inputs">
                  <input
                    aria-label="最小大小"
                    inputMode="decimal"
                    placeholder="min"
                    value={searchMinSizeMb}
                    onChange={(event) => setSearchMinSizeMb(event.target.value)}
                  />
                  <input
                    aria-label="最大大小"
                    inputMode="decimal"
                    placeholder="max"
                    value={searchMaxSizeMb}
                    onChange={(event) => setSearchMaxSizeMb(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>评分</span>
                <div className="range-inputs">
                  <input
                    aria-label="最低评分"
                    inputMode="numeric"
                    placeholder="min"
                    value={searchMinRating}
                    onChange={(event) => setSearchMinRating(event.target.value)}
                  />
                  <input
                    aria-label="最高评分"
                    inputMode="numeric"
                    placeholder="max"
                    value={searchMaxRating}
                    onChange={(event) => setSearchMaxRating(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>日期</span>
                <div className="range-inputs">
                  <input
                    aria-label="开始日期"
                    type="date"
                    value={searchDateFrom}
                    onChange={(event) => setSearchDateFrom(event.target.value)}
                  />
                  <input
                    aria-label="结束日期"
                    type="date"
                    value={searchDateTo}
                    onChange={(event) => setSearchDateTo(event.target.value)}
                  />
                </div>
              </label>
              <label>
                <span>收藏</span>
                <select
                  aria-label="收藏状态"
                  value={searchFavorite}
                  onChange={(event) => setSearchFavorite(event.target.value)}
                >
                  <option value="any">不限</option>
                  <option value="favorite">已收藏</option>
                  <option value="plain">未收藏</option>
                </select>
              </label>
            </section>
          ) : null}

          {isSettingsOpen ? (
            <section className="settings-panel" aria-label="设置">
              <label>
                <span>主题</span>
                <select value={theme} onChange={(event) => setTheme(event.target.value)}>
                  <option value="system">系统</option>
                  <option value="light">浅色</option>
                  <option value="dark">深色</option>
                </select>
              </label>
              <label>
                <span>语言</span>
                <select value={language} onChange={(event) => setLanguage(event.target.value)}>
                  <option value="zh-CN">简体中文</option>
                  <option value="en-US">English</option>
                </select>
              </label>
              <label>
                <span>快捷键</span>
                <select
                  value={shortcutProfile}
                  onChange={(event) => setShortcutProfile(event.target.value)}
                >
                  <option value="default">默认</option>
                  <option value="vim">Vim</option>
                  <option value="minimal">精简</option>
                </select>
              </label>
              <label>
                <span>缩略图</span>
                <input
                  max={512}
                  min={64}
                  type="number"
                  value={thumbnailSize}
                  onChange={(event) => setThumbnailSize(event.target.value)}
                />
              </label>
              <div className="settings-actions">
                <button type="button" onClick={() => void savePreferences()}>
                  保存
                </button>
                <button type="button" onClick={() => void runDataTool("backup_database")}>
                  备份
                </button>
                <button type="button" onClick={() => void restoreDatabase()}>
                  恢复
                </button>
                <button type="button" onClick={() => void runDataTool("rebuild_index")}>
                  重建
                </button>
                <button type="button" onClick={() => void runDataTool("export_library_data")}>
                  导出
                </button>
              </div>
            </section>
          ) : null}

          {searchResults ? (
            <section className="search-results" aria-label="搜索结果">
              <header>
                <strong>搜索结果</strong>
                <button
                  aria-label="关闭搜索结果"
                  className="icon-button compact"
                  title="关闭搜索结果"
                  type="button"
                  onClick={clearSearchResults}
                >
                  <X size={14} aria-hidden="true" />
                </button>
              </header>
              <div className="search-result-groups">
                <SearchResultGroup
                  title="合集"
                  emptyText="无合集"
                  items={searchResults.collections.map((collection) => ({
                    id: collection.id,
                    title: collection.name,
                    meta: collection.path,
                    onClick: () => openSearchCollection(collection),
                  }))}
                />
                <SearchResultGroup
                  title="图片"
                  emptyText="无图片"
                  items={searchResults.images.map((image) => ({
                    id: image.id,
                    title: image.fileName,
                    meta: image.path,
                    onClick: () => openSearchImage(image),
                  }))}
                />
                <SearchResultGroup
                  title="标签"
                  emptyText="无标签"
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

          {duplicateResult ? (
            <section className="duplicate-results" aria-label="重复检测结果">
              <header>
                <strong>
                  重复检测：{duplicateResult.hashedCount}/{duplicateResult.scannedCount} 张
                </strong>
                <button
                  aria-label="关闭重复检测结果"
                  className="icon-button compact"
                  title="关闭重复检测结果"
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
                    />
                  ))
                ) : (
                  <p>未发现重复图片</p>
                )}
              </div>
            </section>
          ) : null}

          {selectedCollection ? (
            <>
              <div className="section-heading detail-heading">
                <button
                  aria-label="返回合集"
                  className="icon-button"
                  title="返回合集"
                  type="button"
                  onClick={() => setSelectedCollectionId(null)}
                >
                  <ArrowLeft size={16} aria-hidden="true" />
                </button>
                <h1>{selectedCollection.name}</h1>
                <div className="detail-actions">
                  <span>
                    {selectedTagFilterId === "all"
                      ? `${images.length} 张图片`
                      : `${visibleImages.length}/${images.length} 张图片`}
                  </span>
                  <button
                    aria-label={selectedCollection.isFavorite ? "取消收藏合集" : "收藏合集"}
                    className="icon-button"
                    title={selectedCollection.isFavorite ? "取消收藏合集" : "收藏合集"}
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
                    aria-label="设置合集标签"
                    className="icon-button"
                    title="设置合集标签"
                    type="button"
                    onClick={() => void assignTagsToCollection(selectedCollection)}
                  >
                    <TagIcon size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="编辑合集"
                    className="icon-button"
                    title="编辑合集"
                    type="button"
                    onClick={() => openCollectionEditor(selectedCollection)}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="删除合集记录"
                    className="icon-button danger"
                    title="删除合集记录"
                    type="button"
                    onClick={() => void deleteSelectedCollectionRecord()}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                </div>
              </div>

              <div className="detail-meta">
                <span>{selectedCollection.path}</span>
                <button
                  aria-label="打开所在位置"
                  className="icon-button"
                  title="打开所在位置"
                  type="button"
                  onClick={() => void openPath(selectedCollection.path)}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </button>
              </div>

              <div className="detail-filter-controls">
                <select
                  aria-label="图片标签筛选"
                  value={selectedTagFilterId}
                  onChange={(event) => setSelectedTagFilterId(event.target.value)}
                >
                  <option value="all">全部标签</option>
                  {tags.map((tag) => (
                    <option key={tag.id} value={tag.id}>
                      {tag.name}
                    </option>
                  ))}
                </select>
              </div>

              {selectedCollectionTags.length > 0 ? (
                <div className="tag-strip" aria-label="合集标签">
                  {selectedCollectionTags.map((tag) => (
                    <span className="tag-chip" key={tag.id} style={tagChipStyle(tag)}>
                      {tag.name}
                    </span>
                  ))}
                </div>
              ) : null}

              {selectedImages.length > 0 ? (
                <div className="batch-toolbar" aria-label="批量图片操作">
                  <span>已选 {selectedImages.length} 张</span>
                  <button type="button" onClick={() => void batchMoveImages()}>
                    <MoveRight size={15} aria-hidden="true" />
                    <span>移动</span>
                  </button>
                  <button type="button" onClick={() => void batchCopyImages()}>
                    <Copy size={15} aria-hidden="true" />
                    <span>复制</span>
                  </button>
                  <button type="button" onClick={() => void batchSetImageTags()}>
                    <TagIcon size={15} aria-hidden="true" />
                    <span>标签</span>
                  </button>
                  <button type="button" onClick={() => void batchRateImages()}>
                    <Star size={15} aria-hidden="true" />
                    <span>评分</span>
                  </button>
                  <button className="danger" type="button" onClick={() => void batchDeleteImages()}>
                    <Trash2 size={15} aria-hidden="true" />
                    <span>删除</span>
                  </button>
                  <button type="button" onClick={clearImageSelection}>
                    <X size={15} aria-hidden="true" />
                    <span>取消</span>
                  </button>
                </div>
              ) : null}

              {collectionDropTargets.length > 0 &&
              (selectedImages.length > 0 || draggedImageIds.length > 0) ? (
                <div className="collection-drop-strip" aria-label="图片移动目标">
                  {collectionDropTargets.map((collection) => (
                    <button
                      aria-label={`移动到 ${collection.name}`}
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
                      <small>{collection.imageCount} 张</small>
                    </button>
                  ))}
                </div>
              ) : null}

              <section className="image-surface" ref={imageListRef} aria-busy={imagesLoading}>
                {imagesLoading ? (
                  <div className="empty-state">
                    <h2>加载中</h2>
                    <p>正在读取图片索引。</p>
                  </div>
                ) : visibleImages.length > 0 ? (
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
                              aria-label="选择图片"
                              checked={selectedImageIds.has(image.id)}
                              type="checkbox"
                              onChange={() => toggleImageSelection(image.id)}
                            />
                          </label>
                          <div className="image-thumb-placeholder">
                            {thumbnails[image.id] ? (
                              <img
                                alt=""
                                src={convertFileSrc(thumbnails[image.id].cachePath)}
                              />
                            ) : (
                              <FileImage size={20} aria-hidden="true" />
                            )}
                          </div>
                          <div className="image-row-main">
                            <h2>{image.fileName}</h2>
                            <p>{image.path}</p>
                            {(imageTagMap[image.id] ?? []).length > 0 ? (
                              <div className="tag-chip-row" aria-label="图片标签">
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
                                : "尺寸未知"}
                            </span>
                            <span>{formatBytes(image.sizeBytes)}</span>
                            <button
                              aria-label="设置图片标签"
                              className="icon-button compact"
                              title="设置图片标签"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void assignTagsToImage(image);
                              }}
                            >
                              <TagIcon size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label="设为封面"
                              className="icon-button compact"
                              title="设为封面"
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
                              aria-label="重命名图片"
                              className="icon-button compact"
                              title="重命名图片"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void renameImage(image);
                              }}
                            >
                              <Pencil size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label="移动图片"
                              className="icon-button compact"
                              title="移动图片"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void moveImage(image);
                              }}
                            >
                              <MoveRight size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label="复制图片"
                              className="icon-button compact"
                              title="复制图片"
                              type="button"
                              onClick={(event) => {
                                event.stopPropagation();
                                void copyImage(image);
                              }}
                            >
                              <Copy size={14} aria-hidden="true" />
                            </button>
                            <button
                              aria-label="删除图片"
                              className="icon-button compact danger"
                              title="删除图片"
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
                  <div className="empty-state">
                    <h2>{images.length > 0 ? "没有匹配图片" : "暂无图片"}</h2>
                    <p>
                      {images.length > 0
                        ? "调整标签筛选后再试。"
                        : "重新导入或检查文件夹权限后再试。"}
                    </p>
                  </div>
                )}
              </section>
            </>
          ) : (
            <>
              <div className="section-heading">
                <h1>全部合集</h1>
                <span>
                  {status
                    ? `${visibleCollections.length}/${status.collection_count} 个合集`
                    : "初始化中"}
                </span>
              </div>

              <div className="collection-controls">
                <div className="collection-filter-controls">
                  <select
                    aria-label="合集排序"
                    value={sortKey}
                    onChange={(event) => setSortKey(event.target.value as CollectionSortKey)}
                  >
                    <option value="imported">最近导入</option>
                    <option value="name">名称</option>
                    <option value="images">图片数量</option>
                    <option value="size">占用空间</option>
                  </select>
                  <select
                    aria-label="标签筛选"
                    value={selectedTagFilterId}
                    onChange={(event) => setSelectedTagFilterId(event.target.value)}
                  >
                    <option value="all">全部标签</option>
                    {tags.map((tag) => (
                      <option key={tag.id} value={tag.id}>
                        {tag.name}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="collection-view-controls">
                  <button
                    aria-label="创建标签"
                    className="icon-button"
                    title="创建标签"
                    type="button"
                    onClick={() => void createTag()}
                  >
                    <Tags size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="编辑标签"
                    className="icon-button"
                    title="编辑标签"
                    type="button"
                    onClick={() => void editTag()}
                  >
                    <Pencil size={16} aria-hidden="true" />
                  </button>
                  <button
                    aria-label="删除标签"
                    className="icon-button danger"
                    title="删除标签"
                    type="button"
                    onClick={() => void deleteTag()}
                  >
                    <Trash2 size={16} aria-hidden="true" />
                  </button>
                  <div className="segmented-control" aria-label="合集视图">
                    <button
                      aria-label="网格视图"
                      className={viewMode === "grid" ? "active" : ""}
                      title="网格视图"
                      type="button"
                      onClick={() => setViewMode("grid")}
                    >
                      <Grid2X2 size={16} aria-hidden="true" />
                    </button>
                    <button
                      aria-label="列表视图"
                      className={viewMode === "list" ? "active" : ""}
                      title="列表视图"
                      type="button"
                      onClick={() => setViewMode("list")}
                    >
                      <List size={16} aria-hidden="true" />
                    </button>
                  </div>
                </div>
              </div>

              <section className={`collection-surface ${viewMode}`} aria-busy={collectionsLoading}>
                {collectionsLoading ? (
                  <div className="empty-state">
                    <h2>加载中</h2>
                    <p>正在读取本地合集索引。</p>
                  </div>
                ) : visibleCollections.length > 0 ? (
                  visibleCollections.map((collection) => (
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
                        <Images size={24} aria-hidden="true" />
                      </div>
                      <div className="collection-main">
                        <div className="collection-title-row">
                          <h2>{collection.name}</h2>
                          {collection.isFavorite ? <Star size={15} aria-label="已收藏" /> : null}
                        </div>
                        <p>{collection.path}</p>
                        {(collectionTagMap[collection.id] ?? []).length > 0 ? (
                          <div className="tag-chip-row" aria-label="合集标签">
                            {(collectionTagMap[collection.id] ?? []).map((tag) => (
                              <span className="tag-chip compact" key={tag.id} style={tagChipStyle(tag)}>
                                {tag.name}
                              </span>
                            ))}
                          </div>
                        ) : null}
                        <div className="collection-meta">
                          <span>{collection.imageCount} 张</span>
                          <span>{formatBytes(collection.totalSizeBytes)}</span>
                          <span>{formatDate(collection.importedAt)}</span>
                          <span>评分 {collection.rating}/5</span>
                        </div>
                      </div>
                      <div className="collection-actions">
                        <button
                          aria-label={collection.isFavorite ? "取消收藏合集" : "收藏合集"}
                          className="icon-button"
                          title={collection.isFavorite ? "取消收藏合集" : "收藏合集"}
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
                          aria-label="设置合集标签"
                          className="icon-button"
                          title="设置合集标签"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void assignTagsToCollection(collection);
                          }}
                        >
                          <TagIcon size={16} aria-hidden="true" />
                        </button>
                        <button
                          aria-label="复制路径"
                          className="icon-button"
                          title="复制路径"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void copyPath(collection.path);
                          }}
                        >
                          <Copy size={16} aria-hidden="true" />
                        </button>
                        <button
                          aria-label="打开所在位置"
                          className="icon-button"
                          title="打开所在位置"
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            void openPath(collection.path);
                          }}
                        >
                          <ExternalLink size={16} aria-hidden="true" />
                        </button>
                      </div>
                    </article>
                  ))
                ) : (
                  <div className="empty-state">
                    <h2>{collections.length > 0 ? "没有匹配合集" : "暂无合集"}</h2>
                    <p>
                      {collections.length > 0
                        ? "调整搜索关键词后再试。"
                        : "选择本地图片文件夹后，PhotoView 会在本机建立索引。"}
                    </p>
                  </div>
                )}
              </section>
            </>
          )}

          {selectedImportPath ? (
            <div className="selected-folder" aria-label="已选择的导入文件夹">
              <span>{selectedImportPath}</span>
              <div className="selected-folder-actions">
                <button
                  aria-label="复制路径"
                  className="icon-button"
                  title="复制路径"
                  type="button"
                  onClick={handleCopyPath}
                >
                  <Copy size={16} aria-hidden="true" />
                </button>
                <button
                  aria-label="打开所在位置"
                  className="icon-button"
                  title="打开所在位置"
                  type="button"
                  onClick={handleOpenPath}
                >
                  <ExternalLink size={16} aria-hidden="true" />
                </button>
              </div>
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
                <span>{status.image_count} 张图片</span>
                <span>{status.tag_count} 个标签</span>
              </>
            ) : (
              <span>正在初始化数据库</span>
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
            打开
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void renameImage(contextImage);
            }}
          >
            重命名
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void moveImage(contextImage);
            }}
          >
            移动
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void copyImage(contextImage);
            }}
          >
            复制
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              void assignTagsToImage(contextImage);
            }}
          >
            标签
          </button>
          <button
            role="menuitem"
            type="button"
            onClick={() => {
              setImageContextMenu(null);
              setNotice(
                `${contextImage.fileName}，${contextImage.format}，${formatBytes(
                  contextImage.sizeBytes,
                )}`,
              );
            }}
          >
            信息
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
            删除
          </button>
        </div>
      ) : null}

      {isCollectionEditorOpen && selectedCollection ? (
        <section className="modal-backdrop" role="presentation">
          <form
            aria-label="编辑合集"
            className="collection-editor"
            onSubmit={(event) => void saveCollectionEditor(event)}
          >
            <header>
              <h2>编辑合集</h2>
              <button
                aria-label="关闭编辑"
                className="icon-button"
                title="关闭编辑"
                type="button"
                onClick={() => setIsCollectionEditorOpen(false)}
              >
                <X size={16} aria-hidden="true" />
              </button>
            </header>

            <label>
              <span>名称</span>
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
              <span>描述</span>
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
              <span>评分</span>
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
                取消
              </button>
              <button className="primary-action" disabled={isCollectionSaving} type="submit">
                {isCollectionSaving ? "保存中" : "保存"}
              </button>
            </footer>
          </form>
        </section>
      ) : null}

      {activeImage ? (
        <section
          aria-label="图片查看器"
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
            <div className="viewer-controls" aria-label="查看器工具栏">
              <button type="button" onClick={() => resetViewerTransform("fit")}>
                适应
              </button>
              <button type="button" onClick={() => resetViewerTransform("actual")}>
                1:1
              </button>
              <button aria-label="缩小" title="缩小" type="button" onClick={() => changeViewerZoom(-0.25)}>
                <ZoomOut size={16} aria-hidden="true" />
              </button>
              <span className="viewer-zoom">{Math.round(viewerZoom * 100)}%</span>
              <button aria-label="放大" title="放大" type="button" onClick={() => changeViewerZoom(0.25)}>
                <ZoomIn size={16} aria-hidden="true" />
              </button>
              <button aria-label="旋转 90 度" title="旋转 90 度" type="button" onClick={rotateViewer}>
                <RotateCw size={16} aria-hidden="true" />
              </button>
              <button aria-label="全屏" title="全屏" type="button" onClick={() => void toggleFullscreen()}>
                <Maximize2 size={16} aria-hidden="true" />
              </button>
              <button
                aria-label={isSlideshowActive ? "暂停幻灯片" : "开始幻灯片"}
                title={isSlideshowActive ? "暂停幻灯片" : "开始幻灯片"}
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
                aria-label="图片信息"
                title="图片信息"
                type="button"
                onClick={() => setIsInfoPanelOpen((current) => !current)}
              >
                <Info size={16} aria-hidden="true" />
              </button>
              <button aria-label="关闭查看器" title="关闭查看器" type="button" onClick={closeViewer}>
                <X size={16} aria-hidden="true" />
              </button>
            </div>
          </header>

          <button
            aria-label="上一张"
            className="viewer-nav previous"
            title="上一张"
            type="button"
            onClick={showPreviousImage}
          >
            <ChevronLeft size={28} aria-hidden="true" />
          </button>

          <div className={`viewer-stage ${isInfoPanelOpen ? "with-info" : ""}`}>
            <div className="viewer-canvas">
              {viewerImageState === "loading" ? (
                <div className="viewer-placeholder">正在加载图片</div>
              ) : null}
              {viewerImageState === "error" ? (
                <div className="viewer-placeholder error">图片解码失败</div>
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
              <aside className="viewer-info" aria-label="图片信息">
                <h2>信息</h2>
                <dl>
                  <div>
                    <dt>格式</dt>
                    <dd>{activeImage.format || activeImage.extension || "未知"}</dd>
                  </div>
                  <div>
                    <dt>尺寸</dt>
                    <dd>
                      {(viewerAsset?.width || activeImage.width) &&
                      (viewerAsset?.height || activeImage.height)
                        ? `${viewerAsset?.width || activeImage.width} x ${
                            viewerAsset?.height || activeImage.height
                          }`
                        : "未知"}
                    </dd>
                  </div>
                  <div>
                    <dt>大小</dt>
                    <dd>{formatBytes(activeImage.sizeBytes)}</dd>
                  </div>
                  <div>
                    <dt>路径</dt>
                    <dd title={activeImage.path}>{activeImage.path}</dd>
                  </div>
                </dl>
              </aside>
            ) : null}
          </div>

          <button
            aria-label="下一张"
            className="viewer-nav next"
            title="下一张"
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
}: {
  group: DuplicateGroup;
  onDelete: () => void;
  onOpen: (image: ImageRecord) => void;
}) {
  return (
    <article className="duplicate-group-card">
      <header>
        <span>{group.kind === "exact" ? "完全重复" : `相似 ${group.score}`}</span>
        <button className="danger" type="button" onClick={onDelete}>
          删除其余
        </button>
      </header>
      <div>
        {group.images.map((image, index) => (
          <button key={image.id} type="button" onClick={() => onOpen(image)}>
            <span>{index === 0 ? "保留" : "候选"}</span>
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
): number {
  if (sortKey === "name") {
    return left.name.localeCompare(right.name, "zh-CN");
  }

  if (sortKey === "images") {
    return right.imageCount - left.imageCount;
  }

  if (sortKey === "size") {
    return right.totalSizeBytes - left.totalSizeBytes;
  }

  return new Date(right.importedAt).getTime() - new Date(left.importedAt).getTime();
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

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
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
  return {
    "--thumb-size": `${clamp(Math.round(numberOrNull(thumbnailSize) ?? 192), 64, 512)}px`,
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
