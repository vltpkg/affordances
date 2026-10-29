'use client'

import { useSyncExternalStore } from 'react'
import {
  DEFAULT_PREFERRED_PM,
  PREFERRED_PM_COOKIE,
  PREFERRED_PM_COOKIE_MAX_AGE,
  isPackageManager,
  type PackageManager,
} from '@/lib/package-managers'

const EVENT = 'preferred-package-manager-change'

// the layout's pre-paint script already put the cookie's value on <html data-pm>
const read = (): PackageManager => {
  const pm = document.documentElement.dataset.pm
  return isPackageManager(pm) ? pm : DEFAULT_PREFERRED_PM
}

const subscribe = (callback: () => void) => {
  window.addEventListener(EVENT, callback)
  return () => window.removeEventListener(EVENT, callback)
}

// ported from vlt.io. what shows is CSS (every command renders each package manager's form, keyed off
// <html data-pm>), so pages stay static with no flash; this hook is for what JS needs: copy, and the menu
export const usePreferredPackageManager = () => ({
  preferredPm: useSyncExternalStore(subscribe, read, () => DEFAULT_PREFERRED_PM),
  setPreferredPm,
})

// every command on the page switches together, and the choice holds across pages and visits
const setPreferredPm = (pm: PackageManager) => {
  document.cookie = `${PREFERRED_PM_COOKIE}=${pm}; path=/; max-age=${PREFERRED_PM_COOKIE_MAX_AGE}; SameSite=Lax`
  document.documentElement.dataset.pm = pm
  window.dispatchEvent(new Event(EVENT))
}
