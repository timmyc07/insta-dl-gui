/** @vitest-environment happy-dom */

import { createPinia, setActivePinia, type Pinia } from "pinia";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryHistory,
  createRouter,
  type LocationQueryRaw,
  type Router,
} from "vue-router";

const ipc = vi.hoisted(() => ({
  downloadDirect: vi.fn(),
  downloadPost: vi.fn(),
  checkDownloadStatuses: vi.fn(),
  enqueueFetchedPostDownload: vi.fn(),
  enqueueProfileDownload: vi.fn(),
  fetchProfile: vi.fn(),
  fetchReels: vi.fn(),
  remoteMediaUrl: vi.fn((url: string) => `remote-media:${url}`),
  resolveInput: vi.fn(),
  searchUsers: vi.fn(),
}));

vi.mock("../lib/ipc", () => ({
  ...ipc,
  cancelJob: vi.fn(),
  formatBytes: (n: number) => `${n} B`,
  onJobProgress: vi.fn(),
}));

import ExplorerView from "./ExplorerView.vue";
import DownloadScopeGroup from "../components/DownloadScopeGroup.vue";
import type { ProfilePreview } from "../lib/ipc";
import { useExplorerStore } from "../stores/explorer";
import { useJobsStore } from "../stores/jobs";

const wrappers: Array<{ unmount: () => void }> = [];
let router: Router;

const preview = {
  profile: {
    pk: "42",
    username: "nike",
    full_name: "Nike",
    media_count: 10,
    follower_count: 100,
    is_verified: true,
    avatar_url: "https://cdninstagram.com/avatar.jpg",
  },
  recent_posts: [],

};

const adidasPreview: ProfilePreview = {
  ...preview,
  profile: {
    ...preview.profile,
    pk: "84",
    username: "adidas",
    full_name: "Adidas",
  },
};

function videoPost(pk: string, thumbnail_url: string) {
  return {
    pk,
    code: pk.toUpperCase(),
    caption: pk,
    resources: [{ url: `${thumbnail_url}.mp4`, kind: "video" as const }],
    thumbnail_url,
  };
}

function photoPost(pk: string, thumbnail_url: string) {
  return {
    pk,
    code: pk.toUpperCase(),
    caption: pk,
    resources: [{ url: `${thumbnail_url}.jpg`, kind: "photo" as const }],
    thumbnail_url,
  };
}

function carouselPost(pk: string, thumbnail_url: string) {
  return {
    pk,
    code: pk.toUpperCase(),
    caption: pk,
    resources: [
      { url: `${thumbnail_url}-one.jpg`, kind: "photo" as const },
      { url: `${thumbnail_url}-two.mp4`, kind: "video" as const },
    ],
    thumbnail_url,
  };
}

function unknownPost(pk: string, thumbnail_url: string) {
  return { pk, code: pk.toUpperCase(), caption: pk, resources: [], thumbnail_url };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function render(pinia: Pinia = createPinia()) {
  setActivePinia(pinia);
  const wrapper = mount(ExplorerView, {
    global: {
      plugins: [pinia, router],
      stubs: {
        JobCard: true,
        PostModal: true,
        RouterLink: {
          props: ["to"],
          template: '<a :data-to="JSON.stringify(to)"><slot /></a>',
        },
      },
    },
  });
  wrappers.push(wrapper);
  return wrapper;
}

async function replaceExplorerRoute(query: LocationQueryRaw): Promise<void> {
  await router.replace({ path: "/explore", query });
  await flushPromises();
}

async function loadProfile(
  wrapper: ReturnType<typeof render>,
  value: ProfilePreview = preview,
) {
  ipc.resolveInput.mockResolvedValueOnce({
    kind: "profile",
    username: value.profile.username,
  });
  ipc.fetchProfile.mockResolvedValueOnce(value);
  await wrapper.get("input").setValue(value.profile.username);
  await wrapper.get("form").trigger("submit");
  await flushPromises();
}

function button(wrapper: ReturnType<typeof render>, label: string) {
  const download = wrapper
    .find("[role='group'][aria-label='Download']")
    .findAll("button")
    .find((item) => item.text() === label);
  if (download) return download;
  const found = wrapper.findAll("button").find((item) => item.text() === label);
  if (!found) throw new Error(`Button not found: ${label}`);
  return found;
}

function downloadButtons(wrapper: ReturnType<typeof render>) {
  return wrapper.get("[role='group'][aria-label='Download']").findAll("button");
}

function selection(wrapper: ReturnType<typeof render>, label: string) {
  return wrapper.get(`input[type="checkbox"][aria-label="${label}"]`);
}

function finishJob(jobId: string, state: "done" | "failed" | "cancelled" = "done") {
  const job = useJobsStore().jobs.get(jobId);
  if (!job) throw new Error(`Job not found: ${jobId}`);
  job.state = state;
}

beforeEach(async () => {
  vi.resetAllMocks();
  ipc.checkDownloadStatuses.mockResolvedValue([]);
  ipc.remoteMediaUrl.mockImplementation((url: string) => `remote-media:${url}`);
  router = createRouter({
    history: createMemoryHistory(),
    routes: [{ path: "/explore", component: { template: "<div />" } }],
  });
  await router.replace("/explore");
  await router.isReady();
});

afterEach(() => {
  for (const wrapper of wrappers.splice(0)) wrapper.unmount();
  document.body.replaceChildren();
  vi.useRealTimers();
  window.history.replaceState({}, "", "/");
});

describe("ExplorerView async wiring", () => {

  it("loads a profile requested by a relationship-result deep link before a demo default", async () => {
    await replaceExplorerRoute({ profile: "adidas" });
    window.history.replaceState(
      {},
      "",
      "/explore?demo=remote-media-failure",
    );
    ipc.fetchProfile.mockResolvedValueOnce(adidasPreview);
    const wrapper = render();
    await flushPromises();

    expect(ipc.fetchProfile).toHaveBeenCalledWith("adidas");
    expect(wrapper.get("input").element.value).toBe("@adidas");
    expect(wrapper.text()).toContain("Adidas");
  });

  it("opens a mentioned profile and restores profiles through Back and Forward", async () => {
    const nikeWithPost: ProfilePreview = {
      ...preview,
      recent_posts: [photoPost("post", "https://cdninstagram.com/post")],
    };
    await replaceExplorerRoute({ profile: "nike" });
    ipc.fetchProfile
      .mockResolvedValueOnce(nikeWithPost)
      .mockResolvedValueOnce(adidasPreview)
      .mockResolvedValueOnce(nikeWithPost)
      .mockResolvedValueOnce(adidasPreview);
    const wrapper = render();
    await flushPromises();
    const replace = vi.spyOn(router, "replace");

    expect(wrapper.text()).toContain("Nike");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(1);
    await wrapper.get('[data-media-id="post"] [data-action="preview"]').trigger("click");
    wrapper.getComponent({ name: "PostModal" }).vm.$emit("open-profile", "adidas");
    await flushPromises();

    expect(wrapper.findComponent({ name: "PostModal" }).exists()).toBe(false);
    expect(router.currentRoute.value.query.profile).toBe("adidas");
    expect(ipc.fetchProfile).toHaveBeenLastCalledWith("adidas");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Adidas");
    expect(replace).not.toHaveBeenCalled();

    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("nike");
    expect(wrapper.text()).toContain("Nike");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(3);

    router.forward();
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("adidas");
    expect(wrapper.text()).toContain("Adidas");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(4);
  });

  it("records a noncanonical current profile before opening a mentioned profile", async () => {
    const nikeWithPost: ProfilePreview = {
      ...preview,
      recent_posts: [photoPost("post", "https://cdninstagram.com/post")],
    };
    const wrapper = render();
    await loadProfile(wrapper, nikeWithPost);
    const replace = vi.spyOn(router, "replace");
    const push = vi.spyOn(router, "push");
    ipc.fetchProfile
      .mockResolvedValueOnce(adidasPreview)
      .mockResolvedValueOnce(nikeWithPost);
    await wrapper.get('[data-media-id="post"] [data-action="preview"]').trigger("click");

    wrapper.getComponent({ name: "PostModal" }).vm.$emit("open-profile", "adidas");
    await flushPromises();

    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith({
      path: "/explore",
      query: { profile: "nike" },
    });
    expect(push).toHaveBeenCalledTimes(1);
    expect(push).toHaveBeenCalledWith({
      path: "/explore",
      query: { profile: "adidas" },
    });
    expect(router.currentRoute.value.query.profile).toBe("adidas");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).toContain("Adidas");

    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("nike");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(3);
    expect(wrapper.text()).toContain("Nike");
  });

  it("shows a missing mentioned profile error and Back restores the source profile", async () => {
    const nikeWithPost: ProfilePreview = {
      ...preview,
      recent_posts: [photoPost("post", "https://cdninstagram.com/post")],
    };
    await replaceExplorerRoute({ profile: "nike" });
    ipc.fetchProfile
      .mockResolvedValueOnce(nikeWithPost)
      .mockRejectedValueOnce(new Error("Profile not found"))
      .mockResolvedValueOnce(nikeWithPost);
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-media-id="post"] [data-action="preview"]').trigger("click");

    wrapper.getComponent({ name: "PostModal" }).vm.$emit("open-profile", "missing_user");
    await flushPromises();

    expect(router.currentRoute.value.query.profile).toBe("missing_user");
    expect(wrapper.text()).toContain("Profile not found");

    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("nike");
    expect(wrapper.text()).toContain("Nike");
    expect(wrapper.text()).not.toContain("Profile not found");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(3);
  });

  it("keeps Back on the source profile when the mentioned profile resolves late", async () => {
    const nikeWithPost: ProfilePreview = {
      ...preview,
      recent_posts: [photoPost("post", "https://cdninstagram.com/post")],
    };
    const pendingAdidas = deferred<ProfilePreview>();
    await replaceExplorerRoute({ profile: "nike" });
    ipc.fetchProfile
      .mockResolvedValueOnce(nikeWithPost)
      .mockReturnValueOnce(pendingAdidas.promise)
      .mockResolvedValueOnce(nikeWithPost);
    const wrapper = render();
    await flushPromises();
    await wrapper.get('[data-media-id="post"] [data-action="preview"]').trigger("click");

    wrapper.getComponent({ name: "PostModal" }).vm.$emit("open-profile", "adidas");
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("adidas");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(2);

    router.back();
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("nike");
    expect(wrapper.text()).toContain("Nike");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(3);

    pendingAdidas.resolve(adidasPreview);
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("nike");
    expect(wrapper.text()).toContain("Nike");
    expect(wrapper.text()).not.toContain("Adidas");
    expect(wrapper.text()).not.toContain("Profile not found");
  });

  it("rejects a stale profile response from an older route query", async () => {
    const stale = deferred<ProfilePreview>();
    const pumaPreview: ProfilePreview = {
      ...preview,
      profile: {
        ...preview.profile,
        pk: "126",
        username: "puma",
        full_name: "Puma",
      },
    };
    await replaceExplorerRoute({ profile: "nike" });
    ipc.fetchProfile
      .mockResolvedValueOnce(preview)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(pumaPreview);
    const wrapper = render();
    await flushPromises();

    await router.push({ path: "/explore", query: { profile: "adidas" } });
    await flushPromises();
    await router.push({ path: "/explore", query: { profile: "puma" } });
    await flushPromises();
    expect(wrapper.text()).toContain("Puma");

    stale.resolve(adidasPreview);
    await flushPromises();
    expect(wrapper.text()).toContain("Puma");
    expect(wrapper.text()).not.toContain("Adidas");
  });

  it("does not surface a stale profile rejection after a newer route succeeds", async () => {
    const stale = deferred<ProfilePreview>();
    const pumaPreview: ProfilePreview = {
      ...preview,
      profile: {
        ...preview.profile,
        pk: "126",
        username: "puma",
        full_name: "Puma",
      },
    };
    await replaceExplorerRoute({ profile: "nike" });
    ipc.fetchProfile
      .mockResolvedValueOnce(preview)
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce(pumaPreview);
    const wrapper = render();
    await flushPromises();

    await router.push({ path: "/explore", query: { profile: "adidas" } });
    await flushPromises();
    await router.push({ path: "/explore", query: { profile: "puma" } });
    await flushPromises();
    expect(wrapper.text()).toContain("Puma");

    stale.reject(new Error("Stale Adidas failure"));
    await flushPromises();
    expect(router.currentRoute.value.query.profile).toBe("puma");
    expect(wrapper.text()).toContain("Puma");
    expect(wrapper.text()).not.toContain("Stale Adidas failure");
  });

  it("closes the modal without navigation or refetch for the current profile", async () => {
    const nikeWithPost: ProfilePreview = {
      ...preview,
      recent_posts: [photoPost("post", "https://cdninstagram.com/post")],
    };
    await replaceExplorerRoute({ profile: "nike" });
    ipc.fetchProfile.mockResolvedValueOnce(nikeWithPost);
    const wrapper = render();
    await flushPromises();
    const push = vi.spyOn(router, "push");
    const replace = vi.spyOn(router, "replace");
    await wrapper.get('[data-media-id="post"] [data-action="preview"]').trigger("click");

    wrapper.getComponent({ name: "PostModal" }).vm.$emit("open-profile", "NIKE");
    await flushPromises();

    expect(wrapper.findComponent({ name: "PostModal" }).exists()).toBe(false);
    expect(router.currentRoute.value.query.profile).toBe("nike");
    expect(ipc.fetchProfile).toHaveBeenCalledTimes(1);
    expect(push).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("auto-loads the neutral profile for the remote-media failure demo", async () => {
    window.history.replaceState({}, "", "/explore?mock=1&demo=remote-media-failure");
    ipc.fetchProfile.mockResolvedValueOnce({
      ...preview,
      profile: {
        ...preview.profile,
        username: "preview_demo",
        full_name: "Preview Demo",
      },
    });
    const wrapper = render();
    await flushPromises();

    expect(ipc.fetchProfile).toHaveBeenCalledWith("preview_demo");
    expect(wrapper.get("input").element.value).toBe("@preview_demo");
  });

  it("keeps the healthy Explore demo defaulting to natgeo", async () => {
    window.history.replaceState({}, "", "/explore?mock=1&demo=explore");
    ipc.fetchProfile.mockResolvedValueOnce(preview);
    const wrapper = render();
    await flushPromises();

    expect(ipc.fetchProfile).toHaveBeenCalledWith("natgeo");
    expect(wrapper.get("input").element.value).toBe("@natgeo");
  });

  it("filters loaded Posts for the grid and Shown download while preserving hidden selected posts", async () => {
    const photo = photoPost("photo", "https://cdninstagram.com/photo");
    const video = videoPost("video", "https://cdninstagram.com/video");
    const carousel = carouselPost("carousel", "https://cdninstagram.com/carousel");
    const unknown = unknownPost("unknown", "https://cdninstagram.com/unknown");
    ipc.enqueueFetchedPostDownload
      .mockResolvedValueOnce("job-shown-videos")
      .mockResolvedValueOnce("job-selected-filtered");
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photo, video, carousel, unknown],
    });

    expect(wrapper.findAll("[data-media-id]").map((item) => item.attributes("data-media-id"))).toEqual([
      "photo",
      "video",
      "carousel",
      "unknown",
    ]);
    expect(button(wrapper, "Shown 3").exists()).toBe(true);

    await wrapper.get('[data-post-filter="videos"]').trigger("click");
    expect(wrapper.get('[data-post-filter="videos"]').attributes("aria-pressed")).toBe("true");
    expect(wrapper.get('[data-post-filter="videos"]').attributes("aria-current")).toBe("true");
    expect(wrapper.get('[data-post-filter="all"]').attributes("aria-pressed")).toBe("false");
    expect(wrapper.findAll("[data-media-id]").map((item) => item.attributes("data-media-id"))).toEqual([
      "video",
    ]);
    expect(button(wrapper, "Shown 1").exists()).toBe(true);
    await button(wrapper, "Shown 1").trigger("click");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenNthCalledWith(
      1,
      "nike",
      "posts",
      "shown",
      [video],
    );
    finishJob("job-shown-videos");

    await wrapper.get('[data-post-filter="photos"]').trigger("click");
    await selection(wrapper, "Select post PHOTO").setValue(true);
    await wrapper.get('[data-post-filter="videos"]').trigger("click");
    await selection(wrapper, "Select post VIDEO").setValue(true);
    expect(button(wrapper, "Selected 2").exists()).toBe(true);
    await button(wrapper, "Selected 2").trigger("click");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenNthCalledWith(
      2,
      "nike",
      "posts",
      "selected",
      [photo, video],
    );

    await wrapper.get('[data-post-filter="carousels"]').trigger("click");
    expect(wrapper.findAll("[data-media-id]").map((item) => item.attributes("data-media-id"))).toEqual([
      "carousel",
    ]);
    expect(button(wrapper, "Shown 1").exists()).toBe(true);
    await wrapper.get('[data-post-filter="photos"]').trigger("click");
    expect(wrapper.findAll("[data-media-id]").map((item) => item.attributes("data-media-id"))).toEqual([
      "photo",
    ]);
    expect(button(wrapper, "Shown 1").exists()).toBe(true);
    await wrapper.get('[data-post-filter="all"]').trigger("click");
    expect(wrapper.findAll("[data-media-id]").map((item) => item.attributes("data-media-id"))).toEqual([
      "photo",
      "video",
      "carousel",
      "unknown",
    ]);
    expect(button(wrapper, "Shown 3").exists()).toBe(true);
    finishJob("job-selected-filtered");
    await flushPromises();
  });

  it("keeps resource-less Posts visible but excludes them from exact downloads and selection", async () => {
    const photo = photoPost("photo", "https://cdninstagram.com/photo");
    const video = videoPost("video", "https://cdninstagram.com/video");
    const carousel = carouselPost("carousel", "https://cdninstagram.com/carousel");
    const unknown = unknownPost("unknown", "https://cdninstagram.com/unknown");
    ipc.enqueueFetchedPostDownload
      .mockResolvedValueOnce("job-valid-shown")
      .mockResolvedValueOnce("job-valid-selected");
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photo, video, carousel, unknown],
    });

    expect(wrapper.findAll("[data-media-id]")).toHaveLength(4);
    expect(button(wrapper, "Shown 3").exists()).toBe(true);
    const unavailableTile = wrapper.get('[data-media-id="unknown"]');
    const unavailableInput = selection(wrapper, "Select post UNKNOWN");
    expect(unavailableTile.get("[data-download-unavailable]").text()).toBe("Unavailable");
    expect(unavailableInput.attributes("disabled")).toBeDefined();
    expect(unavailableInput.attributes("aria-describedby")).toBeTruthy();
    await unavailableInput.trigger("change");
    expect(useExplorerStore().isSelected("posts", "unknown")).toBe(false);

    await button(wrapper, "Shown 3").trigger("click");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenNthCalledWith(
      1,
      "nike",
      "posts",
      "shown",
      [photo, video, carousel],
    );
    finishJob("job-valid-shown");
    await flushPromises();

    const store = useExplorerStore();
    store.selected.posts.push("unknown");
    await selection(wrapper, "Select post PHOTO").setValue(true);
    expect(button(wrapper, "Selected 1").exists()).toBe(true);
    await button(wrapper, "Selected 1").trigger("click");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenNthCalledWith(
      2,
      "nike",
      "posts",
      "selected",
      [photo],
    );
  });

  it("uses a filter-specific empty state for every empty Posts media filter", async () => {
    const cases = [
      {
        filter: "photos",
        label: "photos",
        posts: [videoPost("video", "https://cdninstagram.com/video")],
      },
      {
        filter: "videos",
        label: "videos",
        posts: [photoPost("photo", "https://cdninstagram.com/photo")],
      },
      {
        filter: "carousels",
        label: "carousels",
        posts: [photoPost("photo", "https://cdninstagram.com/photo")],
      },
    ] as const;

    for (const entry of cases) {
      const wrapper = render();
      await loadProfile(wrapper, {
        ...preview,
        recent_posts: [...entry.posts],

      });

      await wrapper.get(`[data-post-filter="${entry.filter}"]`).trigger("click");
      expect(wrapper.findAll("[data-media-id]")).toHaveLength(0);
      expect(wrapper.text()).toContain(`No ${entry.label} in 1 loaded post.`);
      expect(wrapper.text()).not.toContain("No posts yet.");
      expect(button(wrapper, "Shown 0").attributes("disabled")).toBeDefined();
      wrapper.unmount();
    }
  });

  it("persists the active Posts filter and filtered grid across an Explorer remount", async () => {
    const pinia = createPinia();
    const photo = photoPost("photo", "https://cdninstagram.com/photo");
    const video = videoPost("video", "https://cdninstagram.com/video");
    const first = render(pinia);
    await loadProfile(first, { ...preview, recent_posts: [photo, video] });

    await first.get('[data-post-filter="videos"]').trigger("click");
    first.unmount();

    const second = render(pinia);
    expect(second.get('[data-post-filter="videos"]').attributes("aria-pressed")).toBe("true");
    expect(second.get('[data-post-filter="videos"]').attributes("aria-current")).toBe("true");
    expect(second.findAll("[data-media-id]").map((item) => item.attributes("data-media-id"))).toEqual([
      "video",
    ]);
  });

  it("leaves active download rendering to the global application footer", async () => {
    const wrapper = render();
    useJobsStore().addPlaceholder("job-1", "@instagram stories");
    await flushPromises();

    expect(wrapper.find("job-card-stub").exists()).toBe(false);
  });

  it("does not commit a pending profile after the user edits the query", async () => {
    ipc.resolveInput.mockResolvedValue({ kind: "profile", username: "nike" });
    const pending = deferred<typeof preview>();
    ipc.fetchProfile.mockReturnValue(pending.promise);
    const wrapper = render();
    const input = wrapper.get("input");
    await input.setValue("nike");
    await wrapper.get("form").trigger("submit");
    await input.setValue("adidas");
    pending.resolve(preview);
    await flushPromises();

    expect(wrapper.text()).not.toContain("Nike");
    expect(wrapper.text()).not.toContain("Loading profile");
  });

  it("keeps tabs and downloads on the first row with a clean Posts filter row below", async () => {
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("photo", "https://cdninstagram.com/photo")],
    });

    const toolbar = wrapper.get("[data-explorer-toolbar]");
    expect(toolbar.find('[data-explore-tabs]').exists()).toBe(true);
    expect(toolbar.find('[aria-label="Download"]').exists()).toBe(true);
    expect(toolbar.find('[aria-label="Posts filter"]').exists()).toBe(false);

    const filterRow = wrapper.get("[data-post-filter-row]");
    const filters = filterRow.findAll("button");
    expect(filterRow.find('[aria-label="Posts filter"]').exists()).toBe(true);
    expect(filters).toHaveLength(4);
    expect(filters.every((filter) => filter.classes().includes("border-l"))).toBe(true);
    expect(filters[0].classes()).toContain("shadow-[inset_0_-2px_0_var(--color-accent)]");
    expect(filters[0].classes()).not.toContain("ring-1");
  });

  it("suppresses duplicate group actions, disables the group, and retries after failure", async () => {
    const pending = deferred<string>();
    ipc.enqueueProfileDownload.mockReturnValueOnce(pending.promise).mockResolvedValueOnce("job-2");
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });
    const download = button(wrapper, "All");

    await download.trigger("click");
    await download.trigger("click");
    expect(ipc.enqueueProfileDownload).toHaveBeenCalledTimes(1);
    expect(downloadButtons(wrapper).every((item) => item.attributes("disabled") !== undefined)).toBe(true);

    pending.reject(new Error("network"));
    await flushPromises();
    expect(wrapper.text()).toContain("Error: network");
    expect(button(wrapper, "All").attributes("disabled")).toBeUndefined();
    expect(button(wrapper, "Shown 1").attributes("disabled")).toBeUndefined();
    await button(wrapper, "All").trigger("click");
    await flushPromises();
    expect(ipc.enqueueProfileDownload).toHaveBeenCalledTimes(2);
  });

  it("keeps an accepted snapshot busy until its queued job becomes terminal", async () => {
    ipc.enqueueFetchedPostDownload
      .mockResolvedValueOnce("job-shown")
      .mockResolvedValueOnce("job-shown-retry");
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });

    await button(wrapper, "Shown 1").trigger("click");
    await flushPromises();

    expect(useJobsStore().jobs.get("job-shown")?.conflictKeys).toEqual([
      "folder:nike:posts",
    ]);
    expect(downloadButtons(wrapper).every((item) => item.attributes("disabled") !== undefined)).toBe(true);
    await button(wrapper, "Shown 1").trigger("click");
    wrapper.getComponent(DownloadScopeGroup).vm.$emit("download-shown");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(1);

    finishJob("job-shown");
    await flushPromises();
    expect(button(wrapper, "Shown 1").attributes("disabled")).toBeUndefined();
    await button(wrapper, "Shown 1").trigger("click");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(2);
  });

  it("uses the profile conflict from All to block other tabs", async () => {
    ipc.enqueueProfileDownload.mockResolvedValue("job-all-posts");
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });
    await button(wrapper, "All").trigger("click");
    await flushPromises();

    expect(useJobsStore().jobs.get("job-all-posts")?.conflictKeys).toEqual([
      "profile:nike",
      "folder:nike:posts",
    ]);
    await button(wrapper, "Videos").trigger("click");
    expect(downloadButtons(wrapper).every((item) => item.attributes("disabled") !== undefined)).toBe(true);
    wrapper.getComponent(DownloadScopeGroup).vm.$emit("download-all");
    wrapper.getComponent(DownloadScopeGroup).vm.$emit("download-shown");
    await flushPromises();
    expect(ipc.enqueueProfileDownload).toHaveBeenCalledTimes(1);
    expect(ipc.enqueueFetchedPostDownload).not.toHaveBeenCalled();

    finishJob("job-all-posts");
    await flushPromises();
    expect(button(wrapper, "All").attributes("disabled")).toBeUndefined();
  });

  it("retains accepted job conflicts across an Explore remount", async () => {
    const pinia = createPinia();
    ipc.enqueueFetchedPostDownload.mockResolvedValue("job-remount");
    const first = render(pinia);
    await loadProfile(first, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });
    await button(first, "Shown 1").trigger("click");
    await flushPromises();
    first.unmount();

    const second = render(pinia);
    await flushPromises();
    expect(downloadButtons(second).every((item) => item.attributes("disabled") !== undefined)).toBe(true);
    finishJob("job-remount");
    await flushPromises();
    expect(button(second, "Shown 1").attributes("disabled")).toBeUndefined();
  });

  it("retains a pending enqueue reservation across remount and transfers it to the accepted job", async () => {
    const pinia = createPinia();
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload.mockReturnValue(pending.promise);
    const first = render(pinia);
    await loadProfile(first, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });
    await button(first, "Shown 1").trigger("click");
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(1);
    first.unmount();

    const second = render(pinia);
    await flushPromises();
    expect(downloadButtons(second).every((item) => item.attributes("disabled") !== undefined)).toBe(true);
    second.getComponent(DownloadScopeGroup).vm.$emit("download-shown");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(1);

    pending.resolve("job-pending-remount");
    await flushPromises();
    expect(useJobsStore().jobs.get("job-pending-remount")?.conflictKeys).toEqual([
      "folder:nike:posts",
    ]);
    expect(downloadButtons(second).every((item) => item.attributes("disabled") !== undefined)).toBe(true);

    finishJob("job-pending-remount");
    await flushPromises();
    expect(button(second, "Shown 1").attributes("disabled")).toBeUndefined();
  });

  it("releases a remounted pending reservation after enqueue failure and allows retry", async () => {
    const pinia = createPinia();
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload
      .mockReturnValueOnce(pending.promise)
      .mockResolvedValueOnce("job-after-error");
    const first = render(pinia);
    await loadProfile(first, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });
    await button(first, "Shown 1").trigger("click");
    first.unmount();

    const second = render(pinia);
    await flushPromises();
    expect(button(second, "Shown 1").attributes("disabled")).toBeDefined();
    pending.reject(new Error("enqueue failed"));
    await flushPromises();

    expect(button(second, "Shown 1").attributes("disabled")).toBeUndefined();
    await button(second, "Shown 1").trigger("click");
    await flushPromises();
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(2);
  });

  it("keeps empty Shown and Selected actions disabled and side-effect free", async () => {
    const wrapper = render();
    await loadProfile(wrapper);

    expect(button(wrapper, "Shown 0").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "Selected 0").attributes("disabled")).toBeDefined();
    await button(wrapper, "Shown 0").trigger("click");
    await button(wrapper, "Selected 0").trigger("click");
    await flushPromises();

    expect(ipc.enqueueFetchedPostDownload).not.toHaveBeenCalled();
    expect(ipc.enqueueProfileDownload).not.toHaveBeenCalled();
    expect(ipc.downloadDirect).not.toHaveBeenCalled();
  });

  it("accepts one exact 500-item Shown snapshot", async () => {
    const posts = Array.from({ length: 500 }, (_, index) =>
      videoPost(`p${index}`, `https://cdninstagram.com/post-${index}.jpg`),
    );
    ipc.enqueueFetchedPostDownload.mockResolvedValue("job-500-shown");
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: posts });

    expect(button(wrapper, "Shown 500").attributes("disabled")).toBeUndefined();
    await button(wrapper, "Shown 500").trigger("click");
    await flushPromises();

    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(1);
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledWith(
      "nike",
      "posts",
      "shown",
      posts,
    );
  });

  it("accepts one exact 500-item Selected snapshot", async () => {
    const posts = Array.from({ length: 500 }, (_, index) =>
      videoPost(`p${index}`, `https://cdninstagram.com/post-${index}.jpg`),
    );
    ipc.enqueueFetchedPostDownload.mockResolvedValue("job-500-selected");
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: posts });
    const store = useExplorerStore();
    for (const post of posts) store.toggleSelected("posts", post.pk);
    await flushPromises();

    expect(button(wrapper, "Selected 500").attributes("disabled")).toBeUndefined();
    await button(wrapper, "Selected 500").trigger("click");
    await flushPromises();

    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledTimes(1);
    expect(ipc.enqueueFetchedPostDownload).toHaveBeenCalledWith(
      "nike",
      "posts",
      "selected",
      posts,
    );
  }, 10_000);

  it("blocks a 501-item Shown snapshot before IPC while keeping All and small Selected available", async () => {
    const posts = Array.from({ length: 501 }, (_, index) =>
      videoPost(`p${index}`, `https://cdninstagram.com/post-${index}.jpg`),
    );
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: posts });
    useExplorerStore().toggleSelected("posts", posts[0]!.pk);
    await flushPromises();

    expect(button(wrapper, "All").attributes("disabled")).toBeUndefined();
    expect(button(wrapper, "Shown 501").attributes("disabled")).toBeDefined();
    expect(button(wrapper, "Selected 1").attributes("disabled")).toBeUndefined();
    expect(wrapper.text()).toContain("Shown has 501 items, above the 500-item exact snapshot limit.");
    wrapper.getComponent(DownloadScopeGroup).vm.$emit("download-shown");
    await flushPromises();

    expect(ipc.enqueueFetchedPostDownload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(
      "Shown snapshots are limited to 500 items. Use All for the available recent posts.",
    );
  });

  it("blocks a 501-item Selected snapshot before IPC without truncating or chunking", async () => {
    const posts = Array.from({ length: 501 }, (_, index) =>
      videoPost(`p${index}`, `https://cdninstagram.com/post-${index}.jpg`),
    );
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: posts });
    const store = useExplorerStore();
    for (const post of posts) store.toggleSelected("posts", post.pk);
    await flushPromises();

    expect(button(wrapper, "All").attributes("disabled")).toBeUndefined();
    expect(button(wrapper, "Selected 501").attributes("disabled")).toBeDefined();
    expect(wrapper.text()).toContain("Selected has 501 items, above the 500-item exact snapshot limit.");
    wrapper.getComponent(DownloadScopeGroup).vm.$emit("download-selected");
    await flushPromises();

    expect(ipc.enqueueFetchedPostDownload).not.toHaveBeenCalled();
    expect(wrapper.text()).toContain(
      "Selected snapshots are limited to 500 items. Use All for the available recent posts.",
    );
  }, 10_000);

  it("clears only submitted IDs after success and preserves choices added while pending", async () => {
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload.mockReturnValue(pending.promise);
    const first = videoPost("p1", "https://cdninstagram.com/first.jpg");
    const second = videoPost("p2", "https://cdninstagram.com/second.jpg");
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: [first, second] });

    await selection(wrapper, "Select post P1").setValue(true);
    await button(wrapper, "Selected 1").trigger("click");
    expect(selection(wrapper, "Select post P2").attributes("disabled")).toBeUndefined();
    await selection(wrapper, "Select post P2").setValue(true);
    expect(button(wrapper, "Selected 2").attributes("disabled")).toBeDefined();

    pending.resolve("job-posts");
    await flushPromises();

    expect((selection(wrapper, "Select post P1").element as HTMLInputElement).checked).toBe(false);
    expect((selection(wrapper, "Select post P2").element as HTMLInputElement).checked).toBe(true);
    expect(button(wrapper, "Selected 1").exists()).toBe(true);
  });

  it("preserves a submitted ID that is deselected and reselected while pending", async () => {
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload.mockReturnValue(pending.promise);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });

    const checkbox = selection(wrapper, "Select post P1");
    await checkbox.setValue(true);
    await button(wrapper, "Selected 1").trigger("click");
    await checkbox.setValue(false);
    await checkbox.setValue(true);

    pending.resolve("job-reselected");
    await flushPromises();

    expect((selection(wrapper, "Select post P1").element as HTMLInputElement).checked).toBe(true);
    expect(button(wrapper, "Selected 1").exists()).toBe(true);
  });

  it("clears an accepted submitted selection after the Explore view remounts", async () => {
    const pinia = createPinia();
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload.mockReturnValue(pending.promise);
    const first = render(pinia);
    await loadProfile(first, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });

    await selection(first, "Select post P1").setValue(true);
    await button(first, "Selected 1").trigger("click");
    first.unmount();

    const second = render(pinia);
    expect((selection(second, "Select post P1").element as HTMLInputElement).checked).toBe(true);
    pending.resolve("job-remounted-selection");
    await flushPromises();

    expect((selection(second, "Select post P1").element as HTMLInputElement).checked).toBe(false);
    expect(button(second, "Selected 0").attributes("disabled")).toBeDefined();
  });

  it("retains submitted selection and reports an enqueue failure", async () => {
    ipc.enqueueFetchedPostDownload.mockRejectedValue(new Error("enqueue failed"));
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });

    await selection(wrapper, "Select post P1").setValue(true);
    await button(wrapper, "Selected 1").trigger("click");
    await flushPromises();

    expect((selection(wrapper, "Select post P1").element as HTMLInputElement).checked).toBe(true);
    expect(wrapper.text()).toContain("Error: enqueue failed");
  });

  it("does not let an old profile enqueue clear a replacement profile selection", async () => {
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload.mockReturnValue(pending.promise);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/nike.jpg")],
    });
    await selection(wrapper, "Select post P1").setValue(true);
    await button(wrapper, "Selected 1").trigger("click");

    await loadProfile(wrapper, {
      ...adidasPreview,
      recent_posts: [videoPost("a1", "https://cdninstagram.com/adidas.jpg")],
    });
    await selection(wrapper, "Select post A1").setValue(true);
    pending.resolve("job-nike");
    await flushPromises();

    expect(wrapper.text()).toContain("Adidas");
    expect((selection(wrapper, "Select post A1").element as HTMLInputElement).checked).toBe(true);
    expect(button(wrapper, "Selected 1").exists()).toBe(true);
  });

  it("does not let a same-username ABA enqueue clear a fresh selection", async () => {
    const pending = deferred<string>();
    ipc.enqueueFetchedPostDownload.mockReturnValue(pending.promise);
    const profileWithPost = {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    };
    const wrapper = render();
    await loadProfile(wrapper, profileWithPost);
    await selection(wrapper, "Select post P1").setValue(true);
    await button(wrapper, "Selected 1").trigger("click");

    await loadProfile(wrapper, { ...profileWithPost, profile: { ...profileWithPost.profile } });
    await selection(wrapper, "Select post P1").setValue(true);
    pending.resolve("job-old-nike");
    await flushPromises();

    expect((selection(wrapper, "Select post P1").element as HTMLInputElement).checked).toBe(true);
    expect(button(wrapper, "Selected 1").exists()).toBe(true);
  });

  it("keeps selection controls as preview-button siblings without nested interactive HTML", async () => {
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [videoPost("p1", "https://cdninstagram.com/post.jpg")],
    });

    const mediaTile = wrapper.get("[data-media-id='p1']");
    const mediaPreview = mediaTile.get("button[data-action='preview']");
    const mediaCheckbox = selection(wrapper, "Select post P1");
    expect(mediaTile.element.tagName).toBe("DIV");
    expect(mediaPreview.element.parentElement).toBe(mediaTile.element);
    expect(mediaCheckbox.element.closest("label")?.parentElement).toBe(mediaTile.element);
    expect(mediaTile.findAll("button")).toHaveLength(1);
    expect(mediaTile.findAll("input")).toHaveLength(1);
    expect(mediaTile.find("button input").exists()).toBe(false);
    await mediaCheckbox.trigger("click");
    expect(wrapper.find("post-modal-stub").exists()).toBe(false);
    if (!useExplorerStore().isSelected("posts", "p1")) {
      await mediaCheckbox.trigger("change");
    }
    expect(mediaTile.classes()).toEqual(expect.arrayContaining(["ring-2", "ring-accent"]));
    await mediaPreview.trigger("click");
    expect(wrapper.find("post-modal-stub").exists()).toBe(true);
    wrapper.getComponent({ name: "PostModal" }).vm.$emit("close");
    await flushPromises();

  });

});

describe("ExplorerView downloaded media status", () => {
  function status(
    namespace: "post" | "story",
    pk: string,
    state: "downloaded" | "partial" | "not_downloaded",
    available: number,
    expected: number,
  ) {
    return {
      namespace,
      pk,
      state,
      available_resources: available,
      expected_resources: expected,
    };
  }

  it("requests exact post resource identities after the initial profile page commits", async () => {
    const posts = [
      photoPost("101", "https://cdninstagram.com/photo"),
      videoPost("102", "https://cdninstagram.com/video"),
      carouselPost("103", "https://cdninstagram.com/carousel"),
    ];
    const wrapper = render();

    await loadProfile(wrapper, { ...preview, recent_posts: posts });

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledWith([
      { namespace: "post", pk: "101", resources: ["photo"] },
      { namespace: "post", pk: "102", resources: ["video"] },
      { namespace: "post", pk: "103", resources: ["photo", "video"] },
    ]);
  });

  it("renders accessible sibling overlays for downloaded and partial media only", async () => {
    ipc.checkDownloadStatuses.mockResolvedValue([
      status("post", "401", "downloaded", 1, 1),
      status("post", "402", "partial", 1, 2),
      status("post", "403", "not_downloaded", 0, 1),
    ]);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [
        photoPost("401", "https://cdninstagram.com/one"),
        carouselPost("402", "https://cdninstagram.com/two"),
        photoPost("403", "https://cdninstagram.com/three"),
      ],
    });

    const downloaded = wrapper.get("[data-media-id='401'] [data-download-status]");
    const partial = wrapper.get("[data-media-id='402'] [data-download-status]");
    expect(downloaded.text()).toBe("Downloaded");
    expect(downloaded.classes()).toEqual(expect.arrayContaining(["pointer-events-none", "text-emerald-300"]));
    expect(partial.text()).toBe("Partial 1/2");
    expect(partial.classes()).toEqual(expect.arrayContaining(["pointer-events-none", "text-amber-300"]));
    expect(downloaded.element.parentElement).toBe(wrapper.get("[data-media-id='401']").element);
    expect(downloaded.element.closest("button")).toBeNull();
    expect(wrapper.find("[data-media-id='403'] [data-download-status]").exists()).toBe(false);
    expect(selection(wrapper, "Select post 401").attributes("disabled")).toBeUndefined();
    expect(selection(wrapper, "Select post 402").attributes("disabled")).toBeUndefined();
  });

  it("clears old badges synchronously when a replacement profile starts loading", async () => {
    ipc.checkDownloadStatuses.mockResolvedValue([
      status("post", "601", "downloaded", 1, 1),
    ]);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("601", "https://cdninstagram.com/nike")],
    });
    expect(wrapper.text()).toContain("Downloaded");

    ipc.resolveInput.mockResolvedValueOnce({ kind: "profile", username: "adidas" });
    ipc.fetchProfile.mockReturnValueOnce(deferred<ProfilePreview>().promise);
    await wrapper.get("input").setValue("adidas");
    await wrapper.get("form").trigger("submit");

    expect(wrapper.find("[data-download-status]").exists()).toBe(false);
  });

  it("ignores an earlier profile status response after a later profile commits", async () => {
    const oldStatus = deferred<ReturnType<typeof status>[]>();
    ipc.checkDownloadStatuses
      .mockReturnValueOnce(oldStatus.promise)
      .mockResolvedValueOnce([status("post", "701", "not_downloaded", 0, 1)]);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("701", "https://cdninstagram.com/nike")],
    });
    await loadProfile(wrapper, {
      ...adidasPreview,
      recent_posts: [photoPost("701", "https://cdninstagram.com/adidas")],
    });

    oldStatus.resolve([status("post", "701", "downloaded", 1, 1)]);
    await flushPromises();

    expect(wrapper.text()).toContain("Adidas");
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(2);
    expect(wrapper.find("[data-download-status]").exists()).toBe(false);
  });

  it("ignores an older same-tab refresh and runs one full follow-up", async () => {
    const initial = deferred<ReturnType<typeof status>[]>();
    ipc.checkDownloadStatuses
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce([
        status("post", "901", "not_downloaded", 0, 1),
        status("post", "902", "downloaded", 1, 1),
      ]);
    const first = photoPost("901", "https://cdninstagram.com/first");
    const second = photoPost("902", "https://cdninstagram.com/second");
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: [first, second] });
    const jobs = useJobsStore();
    jobs.addPlaceholder("newly-finished", "New download");
    finishJob("newly-finished");
    await flushPromises();
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);

    initial.resolve([status("post", "901", "downloaded", 1, 1)]);
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(2);
    expect(ipc.checkDownloadStatuses).toHaveBeenLastCalledWith([
      { namespace: "post", pk: "901", resources: ["photo"] },
      { namespace: "post", pk: "902", resources: ["photo"] },
    ]);
    expect(wrapper.find("[data-media-id='901'] [data-download-status]").exists()).toBe(false);
    expect(wrapper.get("[data-media-id='902'] [data-download-status]").text()).toBe("Downloaded");
  });

  it("ignores status responses that settle after unmount", async () => {
    const stale = deferred<ReturnType<typeof status>[]>();
    ipc.checkDownloadStatuses
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce([status("post", "1101", "not_downloaded", 0, 1)]);
    const pinia = createPinia();
    const first = render(pinia);
    await loadProfile(first, {
      ...preview,
      recent_posts: [photoPost("1101", "https://cdninstagram.com/post")],
    });
    first.unmount();
    const second = render(pinia);
    await flushPromises();

    stale.resolve([status("post", "1101", "downloaded", 1, 1)]);
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(2);
    expect(second.find("[data-download-status]").exists()).toBe(false);
  });

  it("preserves an honest badge and the main Explore error when lookup rejects", async () => {
    ipc.checkDownloadStatuses
      .mockResolvedValueOnce([status("post", "1201", "downloaded", 1, 1)])
      .mockRejectedValueOnce(new Error("catalog unavailable"));
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("1201", "https://cdninstagram.com/post")],
    });
    ipc.downloadDirect.mockRejectedValueOnce(new Error("existing Explore failure"));
    await button(wrapper, "↓ Avatar").trigger("click");
    await flushPromises();
    const priorError = wrapper.get("p.text-err").text();
    expect(priorError).toBe("Error: existing Explore failure");

    useJobsStore().addPlaceholder("lookup-failure", "download");
    finishJob("lookup-failure", "failed");
    await flushPromises();

    expect(wrapper.get("[data-download-status]").text()).toBe("Downloaded");
    expect(wrapper.text()).not.toContain("catalog unavailable");
    expect(wrapper.get("p.text-err").text()).toBe(priorError);
  });

  it("removes a previous badge after an honest not-downloaded refresh", async () => {
    ipc.checkDownloadStatuses
      .mockResolvedValueOnce([status("post", "1301", "downloaded", 1, 1)])
      .mockResolvedValueOnce([status("post", "1301", "not_downloaded", 0, 1)]);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("1301", "https://cdninstagram.com/post")],
    });
    expect(wrapper.text()).toContain("Downloaded");
    useJobsStore().addPlaceholder("honest-removal", "download");
    finishJob("honest-removal");
    await flushPromises();

    expect(wrapper.find("[data-download-status]").exists()).toBe(false);
  });

  it("refreshes the full retained active tab after remount", async () => {
    const pinia = createPinia();
    const posts = [
      photoPost("1401", "https://cdninstagram.com/one"),
      videoPost("1402", "https://cdninstagram.com/two"),
    ];
    const first = render(pinia);
    await loadProfile(first, { ...preview, recent_posts: posts });
    first.unmount();
    ipc.checkDownloadStatuses.mockClear();
    ipc.checkDownloadStatuses.mockResolvedValue([
      status("post", "1401", "downloaded", 1, 1),
      status("post", "1402", "downloaded", 1, 1),
    ]);

    const second = render(pinia);
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledWith([
      { namespace: "post", pk: "1401", resources: ["photo"] },
      { namespace: "post", pk: "1402", resources: ["video"] },
    ]);
    expect(second.findAll("[data-download-status]")).toHaveLength(2);
  });

  it("preserves the whole prior map when the second chunk of a 501-item full refresh rejects", async () => {
    const posts = Array.from({ length: 501 }, (_, index) =>
      photoPost(String(2000 + index), `https://cdninstagram.com/${index}`),
    );
    const requests = posts.map((post) => ({
      namespace: "post" as const,
      pk: post.pk,
      resources: ["photo" as const],
    }));
    ipc.checkDownloadStatuses
      .mockResolvedValueOnce([status("post", posts[0]!.pk, "downloaded", 1, 1)])
      .mockResolvedValueOnce([status("post", posts[500]!.pk, "partial", 1, 2)]);
    const wrapper = render();
    await loadProfile(wrapper, { ...preview, recent_posts: posts });

    expect(wrapper.get(`[data-media-id='${posts[0]!.pk}'] [data-download-status]`).text()).toBe(
      "Downloaded",
    );
    expect(wrapper.get(`[data-media-id='${posts[500]!.pk}'] [data-download-status]`).text()).toBe(
      "Partial 1/2",
    );
    expect(wrapper.findAll("[data-download-status]")).toHaveLength(2);

    ipc.checkDownloadStatuses.mockReset();
    ipc.checkDownloadStatuses
      .mockImplementationOnce(async (items: Array<{ pk: string }>) =>
        items.map((item, index) =>
          status("post", item.pk, index === 0 ? "not_downloaded" : "downloaded", index === 0 ? 0 : 1, 1),
        ),
      )
      .mockRejectedValueOnce(new Error("second chunk failed"));
    useJobsStore().addPlaceholder("full-501-refresh", "download");
    finishJob("full-501-refresh");
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(2);
    expect(ipc.checkDownloadStatuses).toHaveBeenNthCalledWith(1, requests.slice(0, 500));
    expect(ipc.checkDownloadStatuses).toHaveBeenNthCalledWith(2, requests.slice(500));
    expect(wrapper.findAll("[data-download-status]")).toHaveLength(2);
    expect(wrapper.get(`[data-media-id='${posts[0]!.pk}'] [data-download-status]`).text()).toBe(
      "Downloaded",
    );
    expect(wrapper.get(`[data-media-id='${posts[500]!.pk}'] [data-download-status]`).text()).toBe(
      "Partial 1/2",
    );
  });

  it("does not add a refresh for a terminal job already present when retained media mounts", async () => {
    const pinia = createPinia();
    setActivePinia(pinia);
    useExplorerStore().commitProfile({
      ...preview,
      recent_posts: [photoPost("2501", "https://cdninstagram.com/retained")],
    });
    useJobsStore().addPlaceholder("already-done", "old download");
    finishJob("already-done");
    render(pinia);
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledWith([
      { namespace: "post", pk: "2501", resources: ["photo"] },
    ]);

    useJobsStore().addPlaceholder("seed-check-progress", "unrelated progress");
    const progress = useJobsStore().jobs.get("seed-check-progress")!;
    progress.state = "downloading";
    progress.currentFile = 1;
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);
  });

  it("does not refresh loaded media for progress-only job changes", async () => {
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("2502", "https://cdninstagram.com/loaded")],
    });
    ipc.checkDownloadStatuses.mockClear();

    useJobsStore().addPlaceholder("progress", "new download");
    const progress = useJobsStore().jobs.get("progress")!;
    progress.state = "downloading";
    progress.currentFile = 2;
    await flushPromises();

    expect(ipc.checkDownloadStatuses).not.toHaveBeenCalled();
    expect(wrapper.find("[data-media-id='2502']").exists()).toBe(true);
  });

  it("refreshes for done, failed, and cancelled transitions and coalesces a tick", async () => {
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("3001", "https://cdninstagram.com/post")],
    });
    ipc.checkDownloadStatuses.mockClear();

    useJobsStore().addPlaceholder("done", "done");
    finishJob("done", "done");
    await flushPromises();
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);

    useJobsStore().addPlaceholder("failed", "failed");
    finishJob("failed", "failed");
    await flushPromises();
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(2);

    useJobsStore().addPlaceholder("cancelled-a", "cancelled-a");
    useJobsStore().addPlaceholder("cancelled-b", "cancelled-b");
    finishJob("cancelled-a", "cancelled");
    finishJob("cancelled-b", "cancelled");
    await flushPromises();
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(3);
  });

  it("queues one full follow-up when a terminal arrives during an in-flight refresh", async () => {
    const initial = deferred<ReturnType<typeof status>[]>();
    ipc.checkDownloadStatuses
      .mockReturnValueOnce(initial.promise)
      .mockResolvedValueOnce([status("post", "4001", "downloaded", 1, 1)]);
    const wrapper = render();
    await loadProfile(wrapper, {
      ...preview,
      recent_posts: [photoPost("4001", "https://cdninstagram.com/post")],
    });

    useJobsStore().addPlaceholder("terminal-during-refresh", "download");
    finishJob("terminal-during-refresh");
    await flushPromises();
    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(1);

    initial.resolve([status("post", "4001", "not_downloaded", 0, 1)]);
    await flushPromises();

    expect(ipc.checkDownloadStatuses).toHaveBeenCalledTimes(2);
    expect(wrapper.get("[data-download-status]").text()).toBe("Downloaded");
  });
});
