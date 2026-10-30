import { ogImage, ogSize } from '@/lib/og'

export const size = ogSize
export const contentType = 'image/png'
export const alt = 'Affordances'

const Image = () => ogImage('Make every page agent-operable')

export default Image
