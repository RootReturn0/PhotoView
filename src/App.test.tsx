import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { invoke } from "@tauri-apps/api/core";
import App from "./App";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (path: string) => `asset://${path}`,
  invoke: vi.fn(),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(() => Promise.resolve(() => undefined)),
}));

const invokeMock = vi.mocked(invoke);

afterEach(() => {
  Reflect.deleteProperty(window, "__TAURI_INTERNALS__");
  invokeMock.mockReset();
});

describe("App", () => {
  it("renders the empty collection workspace", () => {
    render(<App />);

    expect(screen.getByText("PhotoView")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "全部合集" })).toBeInTheDocument();
    expect(screen.getByText("暂无合集")).toBeInTheDocument();
  });

  it("toggles settings and advanced search panels", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(screen.getByRole("heading", { name: "设置" })).toBeInTheDocument();
    expect(screen.getByLabelText("主题")).toHaveValue("system");
    expect(screen.getByLabelText("缩略图")).toHaveValue(192);
    expect(screen.getByLabelText("当前数据库路径")).toHaveTextContent("仅桌面应用显示实际路径");
    expect(screen.getByRole("button", { name: "更改位置" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "筛选" }));
    expect(screen.getByLabelText("高级搜索")).toBeInTheDocument();
    expect(screen.getByLabelText("格式")).toBeInTheDocument();
  });

  it("switches the visible interface language", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "切换到英文" }));

    expect(screen.getByRole("heading", { name: "All collections" })).toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Search" })).toHaveAttribute(
      "placeholder",
      "Search collections, paths, or descriptions",
    );
    expect(screen.queryByText("Language switched to English")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Settings" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Chinese" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(screen.getByRole("button", { name: "English" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
  });

  it("switches sidebar navigation views", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole("button", { name: "收藏" }));
    expect(screen.getByRole("heading", { name: "收藏合集" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "最近" }));
    expect(screen.getByRole("heading", { name: "最近浏览" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "标签" }));
    expect(screen.getByRole("heading", { name: "标签" })).toBeInTheDocument();
  });

  it("keeps tag creation inside the tag management page", async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.queryByRole("button", { name: "创建标签" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "编辑标签" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "删除标签" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "标签" }));

    expect(screen.getByRole("form", { name: "新建标签" })).toBeInTheDocument();
    expect(screen.getByLabelText("标签名称")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "添加标签" })).toBeInTheDocument();
  });

  it("keeps toolbar icon actions named when labels are visually hidden", () => {
    render(<App />);

    expect(screen.getByRole("button", { name: "筛选" })).toHaveAttribute("title", "筛选");
    expect(screen.getByRole("button", { name: "搜索" })).toHaveAttribute("title", "搜索");
    expect(screen.getByRole("button", { name: "重复检测" })).toHaveAttribute("title", "重复检测");
    expect(screen.getByRole("button", { name: "同步图库" })).toHaveAttribute("title", "同步图库");
    expect(
      screen
        .getAllByRole("button", { name: "导入文件夹" })
        .some((button) => button.getAttribute("title") === "导入文件夹"),
    ).toBe(true);
  });

  it("keeps browser-preview search inside a safe desktop-only state", async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.type(screen.getByRole("textbox", { name: "搜索" }), "summer{Enter}");

    expect(screen.getByText("请在桌面应用中搜索")).toBeInTheDocument();
  });

  it("keeps tag assignment stable when clicking a dropdown tag", async () => {
    const user = userEvent.setup();
    Reflect.set(window, "__TAURI_INTERNALS__", {});
    invokeMock.mockImplementation((command) => {
      if (command === "get_app_status") {
        return Promise.resolve(mockStatus(1, 0));
      }
      if (command === "list_collections") {
        return Promise.resolve([mockCollection()]);
      }
      if (command === "list_tags") {
        return Promise.resolve([mockTag()]);
      }
      if (command === "list_collection_tag_assignments") {
        return Promise.resolve([]);
      }
      if (command === "get_settings") {
        return Promise.resolve([]);
      }

      return Promise.resolve(null);
    });

    render(<App />);

    await screen.findByText("测试合集");
    fireEvent.click(screen.getByRole("button", { name: "设置合集标签" }));
    const form = screen.getByRole("form", { name: "设置标签" });
    await user.click(within(form).getByRole("button", { name: "设置标签" }));
    await user.click(within(form).getByLabelText("风景"));

    expect(within(form).getByLabelText("风景")).toBeChecked();
    expect(within(form).getAllByText("风景").length).toBeGreaterThan(1);
  });

  it("moves database storage after the user confirms a new folder", async () => {
    const user = userEvent.setup();
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let databasePath = "/tmp/old/photoview.sqlite";

    Reflect.set(window, "__TAURI_INTERNALS__", {});
    invokeMock.mockImplementation((command) => {
      if (command === "get_app_status") {
        return Promise.resolve(mockStatus(0, 0, databasePath));
      }
      if (command === "list_collections" || command === "list_tags") {
        return Promise.resolve([]);
      }
      if (command === "list_collection_tag_assignments" || command === "get_settings") {
        return Promise.resolve([]);
      }
      if (command === "choose_database_folder") {
        return Promise.resolve("/tmp/new");
      }
      if (command === "move_database_storage") {
        databasePath = "/tmp/new/photoview.sqlite";
        return Promise.resolve({
          path: databasePath,
          message: "数据库存储路径已更新",
        });
      }

      return Promise.resolve(null);
    });

    render(<App />);

    await user.click(screen.getByRole("button", { name: "设置" }));
    expect(await screen.findByText("/tmp/old/photoview.sqlite")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "更改位置" }));

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining("/tmp/new"));
    expect(invokeMock).toHaveBeenCalledWith("move_database_storage", { directory: "/tmp/new" });
    expect(await screen.findByText("/tmp/new/photoview.sqlite")).toBeInTheDocument();
    expect(screen.getByText("数据库路径已更新: /tmp/new/photoview.sqlite")).toBeInTheDocument();

    confirmSpy.mockRestore();
  });
});

function mockStatus(collectionCount: number, imageCount: number, databasePath = "") {
  return {
    product_name: "PhotoView",
    version: "0.1.3",
    paths: {
      app_data_dir: "",
      database_path: databasePath,
      thumbnails_dir: "",
    },
    schema_version: 1,
    current_schema_version: 1,
    collection_count: collectionCount,
    image_count: imageCount,
    tag_count: 1,
  };
}

function mockCollection() {
  return {
    id: "collection-1",
    path: "/tmp/photos",
    name: "测试合集",
    coverImageId: null,
    description: "",
    rating: 0,
    isFavorite: false,
    imageCount: 0,
    totalSizeBytes: 0,
    createdAt: "2026-05-27T00:00:00Z",
    importedAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
    lastViewedAt: null,
    viewCount: 0,
  };
}

function mockTag() {
  return {
    id: "tag-1",
    name: "风景",
    color: "#4f7cff",
    createdAt: "2026-05-27T00:00:00Z",
    updatedAt: "2026-05-27T00:00:00Z",
  };
}
