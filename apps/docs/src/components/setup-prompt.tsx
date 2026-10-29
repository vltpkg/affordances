import { AgentText } from '@affordances/md/react'
import { AgentPrompt } from '@/components/agent-prompt'
import { setupPrompt } from '@/lib/agent-prompt'

// the setup prompt as a card; its markdown twin is a plain text fence
export const SetupPrompt = () => (
  <AgentText block md={`\`\`\`text\n${setupPrompt}\n\`\`\``}>
    <AgentPrompt prompt={setupPrompt} />
  </AgentText>
)
