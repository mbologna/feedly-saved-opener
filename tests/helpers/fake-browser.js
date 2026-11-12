/**
 * In-memory stand-ins for the WebExtension APIs the extension uses. Values go
 * through structuredClone, like real storage, so tests catch accidental
 * sharing of mutable objects.
 */

export function createEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    removeListener: (fn) => listeners.splice(listeners.indexOf(fn), 1),
    hasListener: (fn) => listeners.includes(fn),
    /** Calls every listener and returns their results */
    dispatch: (...args) => Promise.all(listeners.map(fn => fn(...args)))
  };
}

function createStorageArea(areaName, onChanged) {
  const data = new Map();

  function pick(keys) {
    if (keys === null || keys === undefined) {
      return Object.fromEntries([...data].map(([key, value]) => [key, structuredClone(value)]));
    }
    if (typeof keys === 'string') {
      keys = [keys];
    }
    const defaults = Array.isArray(keys) ? {} : keys;
    const names = Array.isArray(keys) ? keys : Object.keys(keys);
    const result = {};
    for (const name of names) {
      if (data.has(name)) {
        result[name] = structuredClone(data.get(name));
      } else if (name in defaults) {
        result[name] = defaults[name];
      }
    }
    return result;
  }

  function emit(changes) {
    if (Object.keys(changes).length > 0) {
      for (const listener of onChanged.listeners) {
        listener(changes, areaName);
      }
    }
  }

  return {
    data,
    async get(keys) {
      return pick(keys);
    },
    async set(values) {
      const changes = {};
      for (const [key, value] of Object.entries(values)) {
        changes[key] = { oldValue: data.get(key), newValue: structuredClone(value) };
        data.set(key, structuredClone(value));
      }
      emit(changes);
    },
    async remove(keys) {
      const changes = {};
      for (const key of typeof keys === 'string' ? [keys] : keys) {
        if (data.has(key)) {
          changes[key] = { oldValue: data.get(key) };
          data.delete(key);
        }
      }
      emit(changes);
    },
    async clear() {
      await this.remove([...data.keys()]);
    }
  };
}

/**
 * @param {Object} [options]
 * @param {boolean} [options.tabGroups] - whether tabs.group/tabGroups exist
 */
export function createFakeBrowser({ tabGroups = true } = {}) {
  const onChanged = createEvent();
  let nextTabId = 100;
  let nextGroupId = 1;
  const alarms = new Map();
  const badge = { text: '', color: null };
  const menus = new Map();

  const browser = {
    storage: {
      local: createStorageArea('local', onChanged),
      session: createStorageArea('session', onChanged),
      onChanged
    },

    tabs: {
      created: [],
      groups: [],
      /** Set to make tabs.create reject, e.g. (props) => props.windowId === 1 */
      failWhen: null,
      async create(props) {
        if (browser.tabs.failWhen?.(props)) {
          throw new Error('Invalid window ID');
        }
        const tab = { id: nextTabId++, url: props.url, active: props.active, windowId: props.windowId ?? browser.windows.currentId };
        browser.tabs.created.push(tab);
        return tab;
      }
    },

    windows: {
      focusedId: 1,
      /** Window that gets tabs created without a windowId */
      currentId: 1,
      async getLastFocused() {
        return { id: browser.windows.focusedId };
      }
    },

    alarms: {
      all: alarms,
      async create(name, info) {
        alarms.set(name, { name, ...info });
      },
      async clear(name) {
        return alarms.delete(name);
      },
      async get(name) {
        return alarms.get(name);
      },
      onAlarm: createEvent()
    },

    action: {
      badge,
      async setBadgeText({ text }) {
        badge.text = text;
      },
      async setBadgeBackgroundColor({ color }) {
        badge.color = color;
      }
    },

    contextMenus: {
      items: menus,
      create(item) {
        menus.set(item.id, { ...item });
      },
      async update(id, props) {
        if (!menus.has(id)) {
          throw new Error(`No menu item ${id}`);
        }
        Object.assign(menus.get(id), props);
      },
      async removeAll() {
        menus.clear();
      },
      onClicked: createEvent()
    },

    commands: {
      onCommand: createEvent(),
      async getAll() {
        return [{ name: 'open-next-batch', shortcut: 'Alt+Shift+O' }];
      }
    },

    runtime: {
      onMessage: createEvent(),
      onInstalled: createEvent(),
      onStartup: createEvent(),
      getManifest: () => ({ version: '3.0.0' })
    }
  };

  if (tabGroups) {
    browser.tabs.failGroup = false;
    browser.tabs.group = async ({ tabIds, groupId, createProperties }) => {
      if (browser.tabs.failGroup) {
        throw new Error('Cannot group tabs');
      }
      if (groupId !== undefined) {
        const group = browser.tabs.groups.find(candidate => candidate.id === groupId);
        if (!group) {
          throw new Error(`No group with id: ${groupId}`);
        }
        group.tabIds.push(...tabIds);
        return groupId;
      }
      const group = { id: nextGroupId++, tabIds: [...tabIds], windowId: createProperties?.windowId, title: null };
      browser.tabs.groups.push(group);
      return group.id;
    };
    browser.tabGroups = {
      async update(groupId, props) {
        Object.assign(browser.tabs.groups.find(group => group.id === groupId), props);
      }
    };
  }

  return browser;
}
