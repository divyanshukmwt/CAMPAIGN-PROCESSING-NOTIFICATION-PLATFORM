import { TestBed } from '@angular/core/testing';
import { TabLockService } from './tab-lock.service';

describe('TabLockService', () => {
  let service: TabLockService;

  beforeEach(() => {
    sessionStorage.clear();
    localStorage.clear();
    TestBed.configureTestingModule({
      providers: [TabLockService],
    });
    service = TestBed.inject(TabLockService);
  });

  afterEach(() => {
    service.ngOnDestroy();
    sessionStorage.clear();
    localStorage.clear();
  });

  it('should generate a unique per-tab ID and store/clear X-Tab-Token in sessionStorage', () => {
    expect(service.tabId).toMatch(/^tab-/);
    expect(service.getTabToken()).toBeNull();

    service.setTabToken('token-abc-123');
    expect(service.getTabToken()).toBe('token-abc-123');

    service.clearTabToken();
    expect(service.getTabToken()).toBeNull();
  });

  it('should detect an active primary tab in localStorage and block as a duplicate tab', () => {
    localStorage.setItem(
      'tms_active_tab_lock',
      JSON.stringify({
        tabId: 'tab-other-primary',
        timestamp: Date.now(),
      }),
    );

    service.initTabGuard();

    expect(service.isDuplicateTab()).toBe(true);
    expect(service.lockReason()).toContain('already open in another browser tab');
  });

  it('should lock the tab when markConflictFromServer is called on 409 TAB_CONFLICT', () => {
    expect(service.isDuplicateTab()).toBe(false);

    service.markConflictFromServer('Active session is locked to another browser tab.');

    expect(service.isDuplicateTab()).toBe(true);
    expect(service.lockReason()).toBe('Active session is locked to another browser tab.');
  });
});
