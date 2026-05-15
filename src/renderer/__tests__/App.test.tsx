// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent } from '@testing-library/react'
import App from '../App'

afterEach(cleanup)

describe('App', () => {
  it('renders the PlotToon shell with sidebar branding', () => {
    render(<App />)
    expect(screen.getByText('PlotToon')).toBeDefined()
  })

  it('renders the project list heading and nav', () => {
    render(<App />)
    const matches = screen.getAllByText('Projects')
    expect(matches.length).toBe(2)
  })

  it('shows empty state with open project button', () => {
    render(<App />)
    expect(screen.getByText('No projects yet')).toBeDefined()
    expect(screen.getByRole('button', { name: 'Open Project' })).toBeDefined()
  })

  it('renders workspace nav button', () => {
    render(<App />)
    const wsButton = screen.getByRole('button', { name: 'Workspace' })
    expect(wsButton).toBeDefined()
  })

  it('navigates to workspace when clicking Workspace nav', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    expect(screen.getByText('Open a project to start editing.')).toBeDefined()
  })

  it('navigates back to projects when clicking Projects nav', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('button', { name: 'Workspace' }))
    fireEvent.click(screen.getByRole('button', { name: 'Projects' }))
    expect(screen.getByText('No projects yet')).toBeDefined()
  })
})
