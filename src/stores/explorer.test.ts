import { createPinia, setActivePinia } from "pinia";
import { beforeEach, describe, expect, it } from "vitest";

import type { Post, ProfilePreview } from "../lib/ipc";
import { useExplorerStore } from "./explorer";

function preview(username: string, pk: string, posts: Post[] = []): ProfilePreview {
  return {
    profile: {
      pk,
      username,
      media_count: posts.length,
      is_verified: false,
    },
    recent_posts: posts,
  };
}

beforeEach(() => {
  setActivePinia(createPinia());
});

describe("Explore session state", () => {

  it("persists a Posts filter without changing retained selections and resets it for a replacement profile", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const first = useExplorerStore();

    expect(first.postFilter).toBe("all");
    first.toggleSelected("posts", "photo-1");
    first.postFilter = "videos";

    const remounted = useExplorerStore(pinia);
    expect(remounted.postFilter).toBe("videos");
    expect(first.isSelected("posts", "photo-1")).toBe(true);

    first.beginProfileLoad();
    expect(first.postFilter).toBe("all");
    expect(first.isSelected("posts", "photo-1")).toBe(false);
  });

  it("retains the current profile and tab in the same Pinia session", () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    const first = useExplorerStore();
    first.query = "@nike";
    first.commitProfile(preview("nike", "42"));
    first.activeTab = "reels";
    first.toggleSelected("posts", "p1");

    const remounted = useExplorerStore(pinia);

    expect(remounted.query).toBe("@nike");
    expect(remounted.profilePreview?.profile.username).toBe("nike");
    expect(remounted.activeTab).toBe("reels");
    expect(remounted.isSelected("posts", "p1")).toBe(true);
  });

  it("tracks selections independently per tab and clears unchanged submitted entries", () => {
    const store = useExplorerStore();
    store.toggleSelected("posts", "p1");
    store.toggleSelected("posts", "p2");
    store.toggleSelected("reels", "r1");

    expect(store.isSelected("posts", "p1")).toBe(true);
    expect(store.isSelected("reels", "p1")).toBe(false);
    store.toggleSelected("posts", "p1");
    expect(store.isSelected("posts", "p1")).toBe(false);

    expect(store.isSelected("posts", "p2")).toBe(true);
    expect(store.isSelected("reels", "r1")).toBe(true);
  });

  it("preserves IDs selected after a selection snapshot", () => {
    const store = useExplorerStore();
    store.toggleSelected("posts", "p1");
    const submitted = store.selectionSnapshot("posts");

    store.toggleSelected("posts", "p2");
    store.clearSubmitted("posts", submitted);

    expect(store.selected.posts).toEqual(["p2"]);
    expect(store.selectionSnapshot("posts")).toHaveLength(1);
  });

  it("does not clear an unrelated public selection without a captured revision", () => {
    const store = useExplorerStore();
    store.toggleSelected("posts", "p1");
    const submitted = store.selectionSnapshot("posts");
    store.selected.posts.push("p2");

    store.clearSubmitted("posts", submitted);

    expect(store.selected.posts).toEqual(["p2"]);
  });

  it("preserves the same ID when it is deselected and reselected while pending", () => {
    const store = useExplorerStore();
    store.toggleSelected("posts", "p1");
    const submitted = store.selectionSnapshot("posts");

    store.toggleSelected("posts", "p1");
    store.toggleSelected("posts", "p1");
    const reselected = store.selectionSnapshot("posts");
    store.clearSubmitted("posts", submitted);

    expect(reselected[0]!.revision).toBeGreaterThan(submitted[0]!.revision);
    expect(store.selected.posts).toEqual(["p1"]);
    expect(store.selectionSnapshot("posts")).toEqual(reselected);
  });


});
