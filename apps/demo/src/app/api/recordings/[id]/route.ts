import { read } from '@/lib/recordings'

export const GET = async (_: Request, ctx: RouteContext<'/api/recordings/[id]'>) => {
  const recording = await read((await ctx.params).id)
  return recording ? Response.json(recording) : new Response('No such recording', { status: 404 })
}
