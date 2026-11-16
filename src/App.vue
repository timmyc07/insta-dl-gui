<script setup lang="ts">
import { onMounted } from "vue";
import { useAppStore } from "./stores/app";
import { useJobsStore } from "./stores/jobs";
import AppBrand from "./components/AppBrand.vue";
import DownloadActivityBar from "./components/DownloadActivityBar.vue";
import RemoteMediaFailureBanner from "./components/RemoteMediaFailureBanner.vue";

const app = useAppStore();
const jobs = useJobsStore();

onMounted(async () => {
  await app.init();
  jobs.init().catch(() => {});
});
</script>

<template>
  <div v-if="!app.ready" class="flex h-full items-center justify-center text-slate-500">
    Loading…
  </div>
  <div v-else class="flex h-full flex-col">
    <header class="flex min-w-0 flex-col items-stretch gap-2 border-b border-line bg-surface-1 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <AppBrand :version="app.appVersion" class="shrink-0" />
      <nav
        aria-label="Primary"
        class="flex w-full min-w-0 max-w-full items-center gap-1 overflow-x-auto pb-1 sm:w-auto sm:overflow-visible sm:pb-0"
      >
        <RouterLink
          v-for="r in [
            { path: '/explore', label: 'Explore' },
            { path: '/download', label: 'Download' },
            { path: '/library', label: 'Library' },
            { path: '/queue', label: 'Queue' },
            { path: '/settings', label: 'Settings' },
          ]"
          :key="r.path"
          :to="r.path"
          class="shrink-0 rounded-lg px-3 py-1.5 text-sm text-slate-400 hover:bg-surface-3 hover:text-slate-200"
          active-class="!text-slate-100 bg-surface-3"
        >
          {{ r.label }}
        </RouterLink>
      </nav>
    </header>
    <RemoteMediaFailureBanner />
    <main id="app-main-content" class="min-h-0 flex-1 overflow-y-auto" tabindex="-1">
      <RouterView />
    </main>
    <DownloadActivityBar />
  </div>
</template>
