import { TestBed } from '@angular/core/testing';
import { MatSnackBar } from '@angular/material/snack-bar';
import { vi } from 'vitest';
import { NotificationService } from './notification.service';

describe('NotificationService', () => {
  let service: NotificationService;
  let snackBarMock: { open: ReturnType<typeof vi.fn> };

  beforeEach(() => {
    snackBarMock = { open: vi.fn() };
    TestBed.configureTestingModule({
      providers: [
        NotificationService,
        { provide: MatSnackBar, useValue: snackBarMock },
      ],
    });
    service = TestBed.inject(NotificationService);
  });

  it('should open a success snackbar with success styling', () => {
    service.success('Task created successfully');
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Task created successfully',
      'Close',
      expect.objectContaining({
        duration: 3500,
        panelClass: ['snackbar-success'],
      }),
    );
  });

  it('should open an error snackbar with error styling', () => {
    service.error('Task not found');
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Task not found',
      'Dismiss',
      expect.objectContaining({
        duration: 5000,
        panelClass: ['snackbar-error'],
      }),
    );
  });

  it('should open an info snackbar with info styling', () => {
    service.info('Loading tasks...');
    expect(snackBarMock.open).toHaveBeenCalledWith(
      'Loading tasks...',
      'OK',
      expect.objectContaining({
        duration: 3500,
        panelClass: ['snackbar-info'],
      }),
    );
  });
});
