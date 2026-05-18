import { ipcMain } from 'electron'
import { buildDashboardData, type DashboardDeps, type DashboardData } from '../services/dashboardData'

export interface DashboardHandlerDeps {
  getDashboardDeps: () => DashboardDeps
}

export function registerDashboardHandlers(deps: DashboardHandlerDeps): void {
  ipcMain.handle('dashboard:getData', async (): Promise<DashboardData> => {
    return buildDashboardData(deps.getDashboardDeps())
  })
}
