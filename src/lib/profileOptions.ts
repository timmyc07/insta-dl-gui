import type { ProfileOptions } from "./ipc";

export function hasProfileSelection(options: Readonly<ProfileOptions>): boolean {
  return options.posts || options.reels || options.avatar;
}
