import { defineStore } from "pinia";
import { reactive, ref } from "vue";

import type { ProfilePostsPage, ProfilePreview } from "../lib/ipc";

export type ExploreTab = "posts" | "reels";
export type PostFilter = "all" | "photos" | "videos" | "carousels";
export interface ExploreSelectionSnapshot {
  pk: string;
  revision: number;
}

export const useExplorerStore = defineStore("explorer", () => {
  const query = ref("");
  const profilePreview = ref<ProfilePreview | null>(null);
  const nextCursor = ref<string | null>();
  const consumedCursors = new Set<string>();
  const activeTab = ref<ExploreTab>("posts");
  const postFilter = ref<PostFilter>("all");
  const selected = reactive<Record<ExploreTab, string[]>>({
    posts: [],
    reels: [],
  });
  const selectionRevisions: Record<ExploreTab, Map<string, number>> = {
    posts: new Map(),
    reels: new Map(),
  };
  let nextSelectionRevision = 0;
  function beginProfileLoad() {
    profilePreview.value = null;
    nextCursor.value = undefined;
    consumedCursors.clear();
    activeTab.value = "posts";
    postFilter.value = "all";
    selected.posts = [];
    selected.reels = [];
    selectionRevisions.posts.clear();
    selectionRevisions.reels.clear();
  }

  function commitProfile(value: ProfilePreview) {
    profilePreview.value = value;
  }

  function appendPostsPage(page: ProfilePostsPage) {
    if (!profilePreview.value) return;
    if (nextCursor.value) consumedCursors.add(nextCursor.value);
    nextCursor.value = page.next_cursor && !consumedCursors.has(page.next_cursor)
      ? page.next_cursor
      : null;

    const posts = profilePreview.value.recent_posts;
    const codes = new Set(posts.map((post) => post.code));
    const ids = new Set(posts.map((post) => post.pk));
    for (const post of page.posts) {
      if (codes.has(post.code) || ids.has(post.pk)) continue;
      codes.add(post.code);
      ids.add(post.pk);
      posts.push(post);
    }
  }

  function toggleSelected(tab: ExploreTab, pk: string) {
    const index = selected[tab].indexOf(pk);
    if (index >= 0) {
      selected[tab].splice(index, 1);
      selectionRevisions[tab].delete(pk);
    } else {
      selected[tab].push(pk);
      selectionRevisions[tab].set(pk, ++nextSelectionRevision);
    }
  }

  function isSelected(tab: ExploreTab, pk: string): boolean {
    return selected[tab].includes(pk);
  }

  function selectionSnapshot(tab: ExploreTab): ExploreSelectionSnapshot[] {
    return selected[tab].map((pk) => {
      let revision = selectionRevisions[tab].get(pk);
      if (revision === undefined) {
        revision = ++nextSelectionRevision;
        selectionRevisions[tab].set(pk, revision);
      }
      return { pk, revision };
    });
  }

  function clearSubmitted(tab: ExploreTab, submittedEntries: readonly ExploreSelectionSnapshot[]) {
    const submitted = new Map(submittedEntries.map((entry) => [entry.pk, entry.revision]));
    selected[tab] = selected[tab].filter((pk) => {
      const submittedRevision = submitted.get(pk);
      if (
        submittedRevision === undefined ||
        submittedRevision !== selectionRevisions[tab].get(pk)
      ) {
        return true;
      }
      selectionRevisions[tab].delete(pk);
      return false;
    });
  }

  return {
    query,
    profilePreview,
    nextCursor,
    activeTab,
    postFilter,
    selected,
    beginProfileLoad,
    commitProfile,
    appendPostsPage,
    toggleSelected,
    isSelected,
    selectionSnapshot,
    clearSubmitted,
  };
});
