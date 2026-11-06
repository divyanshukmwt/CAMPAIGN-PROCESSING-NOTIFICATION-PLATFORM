import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

@Injectable({
  providedIn: 'root',
})
export class NotificationService {
  private readonly snackBar = inject(MatSnackBar);

  success(message: string, duration = 3500): void {
    this.snackBar.open(message, 'Close', {
      duration,
      horizontalPosition: 'end',
      verticalPosition: 'top',
      panelClass: ['snackbar-success'],
    });
  }

  error(message: string, duration = 5000): void {
    this.snackBar.open(message, 'Dismiss', {
      duration,
      horizontalPosition: 'end',
      verticalPosition: 'top',
      panelClass: ['snackbar-error'],
    });
  }

  info(message: string, duration = 3500): void {
    this.snackBar.open(message, 'OK', {
      duration,
      horizontalPosition: 'end',
      verticalPosition: 'top',
      panelClass: ['snackbar-info'],
    });
  }
}
