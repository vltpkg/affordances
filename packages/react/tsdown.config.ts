import { defineConfig } from 'tsdown'
import base from '../../tsdown.config.ts'

// one file per module, so provider.tsx keeps its 'use client' directive
export default defineConfig({ ...base, unbundle: true, platform: 'browser' })
