import fs from 'node:fs/promises'
import path from 'node:path'
import { generateProjectAgentsMd } from './agentsTemplate'
import { writeOrRefreshProjectAgentGuide, PLOTTOON_AGENT_GUIDE_FILENAME } from './agentGuide'

const DIRS = ['characters', 'plots']

interface TemplateFile {
  name: string
  content: (projectName: string) => string
}

const FILES: TemplateFile[] = [
  {
    name: 'structure.md',
    content: (name) =>
      `# ${name} — Story Structure\n\nOutline the overall story arc, chapters, and key plot points.\n`
  },
  {
    name: 'genesis.md',
    content: (name) =>
      `# ${name} — Genesis\n\nRecord the origin of this project: inspiration, themes, and goals.\n`
  },
  {
    name: 'style-guide.md',
    content: (name) =>
      `# ${name} — Style Guide\n\nDefine the visual style: color palette, character design notes, panel conventions.\n`
  },
  {
    name: 'AGENTS.md',
    content: (name) => generateProjectAgentsMd(name)
  },
  {
    name: '.publish-status.json',
    content: () => JSON.stringify({ published: false, lastCheck: null }, null, 2) + '\n'
  }
]

export async function scaffoldProjectTemplate(
  projectRoot: string,
  projectName: string
): Promise<string[]> {
  const created: string[] = []

  for (const dir of DIRS) {
    const dirPath = path.join(projectRoot, dir)
    await fs.mkdir(dirPath, { recursive: true })
    created.push(dir + '/')
  }

  for (const file of FILES) {
    const filePath = path.join(projectRoot, file.name)
    await fs.writeFile(filePath, file.content(projectName), 'utf-8')
    created.push(file.name)
  }

  // #277: write the versioned PlotToon agent guide alongside the
  // static AGENTS.md. The static file pins the never-touch rules; the
  // generated guide carries the live workflow (cuts.json, image
  // generation, AtlasCloud bridge, manual editor handoff) and
  // refreshes when its version stamp changes.
  await writeOrRefreshProjectAgentGuide(projectRoot, { projectName })
  created.push(PLOTTOON_AGENT_GUIDE_FILENAME)

  return created
}

export function getExpectedTemplatePaths(): string[] {
  return [...DIRS.map((d) => d + '/'), ...FILES.map((f) => f.name), PLOTTOON_AGENT_GUIDE_FILENAME]
}
