import { findByStoreName, findByProps } from "@vendetta/metro";
import { FluxDispatcher } from "@vendetta/metro/common";
import { after } from "@vendetta/patcher";
import { storage } from "@vendetta/plugin";
import { showToast } from "@vendetta/ui/toasts";
import Settings from "./Settings";

const DISCORD_ID = "643945264868098049";

// placeholder banner hash, only so the profile UI draws a banner area;
// the real image comes from the override
const PLACEHOLDER_HASH = "discord-editor-banner";

const UserStore = findByStoreName("UserStore");
const AvatarUtils = findByProps("getUserAvatarSource");
const patches: (() => void)[] = [];

// user objects we put the placeholder on, so unload can restore them
const injected = new Map<any, any>();

// display profiles already patched
const handledProfiles = new WeakSet<object>();

// read at call time so edits in settings apply without reloading
function getBanner(userId?: string): string | undefined {
  if (userId !== DISCORD_ID || typeof storage.banner !== "string") return undefined;
  return storage.banner.trim() || undefined;
}

// replaces obj[key] with wrapper(original, self, args) and undoes it on unload
function wrap(obj: any, key: string, wrapper: (original: Function, self: any, args: any[]) => any): boolean {
  try {
    const original = obj?.[key];
    if (typeof original !== "function") return false;
    obj[key] = function (this: any, ...args: any[]) {
      return wrapper(original, this, args);
    };
    patches.push(() => { obj[key] = original; });
    return true;
  } catch (e) {
    console.log(`[DiscordEditor] could not patch ${key}`, e);
    return false;
  }
}

function addPlaceholder(target: any, userId?: string): void {
  if (!target || target.banner || !getBanner(userId)) return;
  try {
    injected.set(target, target.banner);
    target.banner = PLACEHOLDER_HASH;
  } catch { /* frozen objects are left alone */ }
}

// the official Discord account is a system user that may have no profile in the
// store, leaving the profile screen nothing to draw a banner from. this stands in for one
function standInProfile(id: string): any {
  return {
    userId: id,
    banner: PLACEHOLDER_HASH,
    bio: "",
    accentColor: null,
    themeColors: undefined,
    badges: [],
    connectedAccounts: [],
    getBannerURL: () => getBanner(id),
  };
}

// points an existing display profile's getBannerURL at the override
function patchDisplayProfile(profile: any, userId?: string): void {
  const id = userId ?? profile?.userId;
  if (!profile || typeof profile !== "object" || handledProfiles.has(profile) || !getBanner(id)) return;
  handledProfiles.add(profile);

  const original = profile.getBannerURL;
  try {
    if (!profile.banner) {
      Object.defineProperty(profile, "banner", { value: PLACEHOLDER_HASH, configurable: true, writable: true, enumerable: true });
    }
    Object.defineProperty(profile, "getBannerURL", {
      value: (...args: any[]) => getBanner(id) ?? original?.apply(profile, args),
      configurable: true,
      writable: true,
      enumerable: true,
    });
  } catch { /* frozen objects are left alone */ }
}

// the profile screen's hook, called with { user, displayProfile, ... }
function bannerHook(original: Function, self: any, args: any[]) {
  let standIn = false;
  const callArgs = args.map((arg) => {
    if (!arg || typeof arg !== "object") return arg;
    if (arg.displayProfile) {
      patchDisplayProfile(arg.displayProfile, arg.user?.id);
      return arg;
    }
    if ((arg.user?.id ?? arg.userId) === DISCORD_ID && getBanner(DISCORD_ID)) {
      standIn = true;
      return { ...arg, displayProfile: standInProfile(DISCORD_ID) };
    }
    return arg;
  });
  if (!standIn) return original.apply(self, args);

  try {
    return original.apply(self, callArgs);
  } catch {
    return original.apply(self, args);
  }
}

// getUserBannerURL and friends, for screens that build the URL themselves
function urlGetter(original: Function, self: any, args: any[]) {
  const first = args[0];
  const id = typeof first === "string" ? first : (first?.id ?? first?.userId);
  return getBanner(id) ?? original.apply(self, args);
}

// profile lookups: an account with no profile gets a stand-in
const profileLookup = (standIn: boolean) => (original: Function, self: any, args: any[]) => {
  const profile = original.apply(self, args);
  if (args[0] !== DISCORD_ID || !getBanner(DISCORD_ID)) return profile;
  if (!profile && standIn) return standInProfile(DISCORD_ID);
  addPlaceholder(profile, args[0]);
  return profile;
};

function patchBanner() {
  // a placeholder left behind by a load that was never unloaded
  try {
    const user = UserStore.getUser(DISCORD_ID);
    if (user?.banner === PLACEHOLDER_HASH) user.banner = null;
  } catch { /* nothing to clean up */ }

  const hooks = findByProps("useUserProfileBannerBackgroundColor");
  if (hooks) wrap(hooks, "useUserProfileBannerBackgroundColor", bannerHook);

  for (const name of ["getUserBannerURL", "getGuildMemberBannerURL"]) {
    const mod = findByProps(name);
    if (mod) wrap(mod, name, urlGetter);
  }

  const UserProfileStore = findByStoreName("UserProfileStore");
  if (UserProfileStore) {
    wrap(UserProfileStore, "getUserProfile", profileLookup(true));
    wrap(UserProfileStore, "getGuildMemberProfile", profileLookup(false));
  }

  wrap(UserStore, "getUser", (original, self, args) => {
    const user = original.apply(self, args);
    if (args[0] === DISCORD_ID) addPlaceholder(user, args[0]);
    return user;
  });

  // refresh the ui so an existing override shows right away
  try {
    const user = UserStore.getUser(DISCORD_ID);
    if (user) FluxDispatcher.dispatch({ type: "USER_UPDATE", user });
  } catch { /* shows the next time the profile opens */ }
}

export default {
  onLoad() {
    try {
      storage.name ??= "";
      storage.avatar ??= "";
      storage.banner ??= "";

      if (UserStore) {
        patches.push(
          after("getUser", UserStore, ([id]: string[], user: any) => {
            if (id !== DISCORD_ID || !user || !storage.name) return;
            user.username = storage.name;
            user.globalName = storage.name;
          })
        );
        patchBanner();
      }
      if (AvatarUtils) {
        patches.push(
          after("getUserAvatarSource", AvatarUtils, ([user]: any[]) => {
            if (user?.id === DISCORD_ID && storage.avatar) return { uri: storage.avatar };
          })
        );
      }
    } catch (e) {
      console.log("[DiscordEditor] onLoad error", e);
      showToast("Discord Editor error, check logs");
    }
  },
  onUnload() {
    // reverse order so patches stacked on the same function come off cleanly
    patches.splice(0).reverse().forEach((p) => p());
    injected.forEach((original, target) => {
      try { target.banner = original; } catch { /* nothing to restore */ }
    });
    injected.clear();
  },
  settings: Settings,
};
