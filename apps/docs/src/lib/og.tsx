import { ImageResponse } from 'next/og'

export const ogSize = { width: 1200, height: 630 }

// next/og draws in its bundled Geist; the pixel wordmark isn't available as a ttf, so the name is set plainly
export const ogImage = (title: string) =>
  new ImageResponse(
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        padding: 96,
        background: '#000',
        color: '#ededed',
      }}
    >
      <div style={{ display: 'flex', fontSize: 32, color: '#a1a1a1' }}>afford</div>
      <div style={{ display: 'flex', fontSize: 80, letterSpacing: '-0.03em', lineHeight: 1.1 }}>
        {title}
      </div>
    </div>,
    ogSize,
  )
