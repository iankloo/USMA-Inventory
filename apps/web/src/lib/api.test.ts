import { describe, expect, it } from 'vitest'
import { createDemoApi } from './api'

describe('demo API contract', () => {
  it('filters inventory by serial, person, or model', async () => {
    const api = createDemoApi()
    expect((await api.listGuns('WP-24-00187')).map(gun => gun.serial)).toEqual(['WP-24-00187'])
    expect((await api.listGuns('martinez')).map(gun => gun.serial)).toEqual(['WP-24-00187'])
  })

  it('returns explicit outcomes for known and unknown scans', async () => {
    const api = createDemoApi()
    expect((await api.scanAuditSerial('audit-demo', 'WP-24-00187')).outcome).toBe('scanned')
    expect((await api.scanAuditSerial('audit-demo', 'not-a-gun')).outcome).toBe('unexpected')
  })

  it('returns reconciliation findings without retaining source bytes', async () => {
    const api = createDemoApi()
    const result = await api.uploadReconciliation('audit-demo', { sourceName: 'report.pdf', serials: ['WP-24-00312'] })
    expect(result.matched).toBe(192)
    expect(result.missing).toContain('WP-24-00312')
  })
})
