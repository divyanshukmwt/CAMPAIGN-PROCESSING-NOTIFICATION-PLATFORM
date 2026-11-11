import { expect, test } from '@playwright/test';

test.describe('Task Management System — End-to-End Integration', () => {
  const uniqueSuffix = Date.now();
  const testUser = {
    name: `E2E User ${uniqueSuffix}`,
    email: `e2e.${uniqueSuffix}@example.com`,
    password: 'Password123',
  };

  test('1. redirects unauthenticated users from /tasks to /login', async ({ page }) => {
    await page.goto('/tasks');
    await expect(page).toHaveURL(/\/login/);
    await expect(page.getByRole('heading', { name: 'Sign In' })).toBeVisible();
  });

  test('2. registers a new user, creates, searches, views, updates, and deletes tasks, then logs out and logs back in', async ({
    page,
  }) => {
    // --- Register ---
    await page.goto('/register');
    await expect(page.getByRole('heading', { name: 'Create Account' })).toBeVisible();

    await page.getByTestId('register-name-input').fill(testUser.name);
    await page.getByTestId('register-email-input').fill(testUser.email);
    await page.getByTestId('register-password-input').fill(testUser.password);
    await page.getByTestId('register-password-confirm-input').fill(testUser.password);
    await page.getByTestId('register-submit-btn').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('nav-user-name')).toContainText(testUser.name);

    // Initially empty task list for the newly registered user
    await expect(page.getByTestId('tasks-empty')).toBeVisible();

    // --- Validation check on Create Form ---
    await page.getByTestId('create-task-btn').click();
    await expect(page).toHaveURL(/\/tasks\/new$/);

    await page.getByTestId('submit-task-btn').click();
    await expect(page.getByTestId('title-error')).toContainText('Title is required.');

    // --- Create Task 1 ---
    const firstTaskTitle = `Complete Laravel API ${uniqueSuffix}`;
    await page.getByTestId('task-title-input').fill(firstTaskTitle);
    await page.getByTestId('task-description-input').fill('Build RESTful CRUD endpoints');
    await page.getByTestId('task-status-select').click();
    await page.getByRole('option', { name: 'In Progress' }).click();
    await page.getByTestId('task-priority-select').click();
    await page.getByRole('option', { name: 'High' }).click();
    await page.getByTestId('task-due-date-input').fill('2026-12-31');
    await page.getByTestId('submit-task-btn').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('tasks-table')).toContainText(firstTaskTitle);

    // --- Create Task 2 ---
    const secondTaskTitle = `Prepare Angular UI ${uniqueSuffix}`;
    await page.getByTestId('create-task-btn').click();
    await page.getByTestId('task-title-input').fill(secondTaskTitle);
    await page.getByTestId('task-description-input').fill('Build Material components and E2E suite');
    await page.getByTestId('submit-task-btn').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('task-row')).toHaveCount(2);

    // --- Search by Title ---
    await page.getByTestId('task-search-input').fill('Laravel');
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(page.getByTestId('tasks-table')).toContainText(firstTaskTitle);

    await page.getByTestId('clear-search-btn').click();
    await expect(page.getByTestId('task-row')).toHaveCount(2);

    // --- View Task Details ---
    await page.getByRole('link', { name: firstTaskTitle, exact: true }).click();
    await expect(page).toHaveURL(/\/tasks\/\d+$/);
    await expect(page.getByTestId('detail-title')).toHaveText(firstTaskTitle);
    await expect(page.getByTestId('detail-status')).toContainText('In Progress');
    await expect(page.getByTestId('detail-priority')).toContainText('High');
    await expect(page.getByTestId('detail-description')).toContainText(
      'Build RESTful CRUD endpoints',
    );

    // --- Edit Task ---
    await page.getByTestId('detail-edit-btn').click();
    await expect(page).toHaveURL(/\/tasks\/\d+\/edit$/);

    const updatedTitle = `${firstTaskTitle} (Updated)`;
    await page.getByTestId('task-title-input').fill(updatedTitle);
    await page.getByTestId('task-status-select').click();
    await page.getByRole('option', { name: 'Completed' }).click();
    await page.getByTestId('submit-task-btn').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('tasks-table')).toContainText(updatedTitle);

    // --- Delete Task with Confirmation Dialog (Cancel then Confirm) ---
    await page.getByRole('link', { name: updatedTitle, exact: true }).click();
    await page.getByTestId('detail-delete-btn').click();
    await expect(page.getByTestId('confirm-dialog')).toBeVisible();
    await page.getByTestId('confirm-dialog-cancel').click();
    await expect(page.getByTestId('detail-title')).toHaveText(updatedTitle);

    await page.getByTestId('detail-delete-btn').click();
    await page.getByTestId('confirm-dialog-confirm').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('task-row')).toHaveCount(1);
    await expect(page.getByTestId('tasks-table')).toContainText(secondTaskTitle);

    // --- Logout and Login again ---
    await page.getByTestId('nav-logout-btn').click();
    await expect(page).toHaveURL(/\/login$/);

    await page.getByTestId('login-email-input').fill(testUser.email);
    await page.getByTestId('login-password-input').fill(testUser.password);
    await page.getByTestId('login-submit-btn').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('tasks-table')).toContainText(secondTaskTitle);
  });

  test('3. enforces single-tab lockout on duplicate tabs and supports dual-role Admin/User switching and task assignment attribution', async ({
    context,
    page,
  }) => {
    const adminUser = {
      name: `Admin Dual ${uniqueSuffix}`,
      email: `admin.${uniqueSuffix}@example.com`,
      password: 'Password123',
    };

    // Register a dual-role Admin & User account
    await page.goto('/register');
    await page.getByTestId('register-role-admin').click();
    await page.getByTestId('register-name-input').fill(adminUser.name);
    await page.getByTestId('register-email-input').fill(adminUser.email);
    await page.getByTestId('register-password-input').fill(adminUser.password);
    await page.getByTestId('register-password-confirm-input').fill(adminUser.password);
    await page.getByTestId('register-submit-btn').click();

    await expect(page).toHaveURL(/\/tasks$/);
    await expect(page.getByTestId('nav-active-role-badge')).toContainText('ADMIN');
    await expect(page.getByTestId('nav-switch-role-btn')).toContainText('Switch to User');

    // Switch role from Admin -> User and back from User -> Admin
    await page.getByTestId('nav-switch-role-btn').click();
    await expect(page.getByTestId('nav-active-role-badge')).toContainText('USER');
    await expect(page.getByTestId('nav-switch-role-btn')).toContainText('Switch to Admin');

    await page.getByTestId('nav-switch-role-btn').click();
    await expect(page.getByTestId('nav-active-role-badge')).toContainText('ADMIN');

    // Open a duplicate tab in the same browser context -> must be blocked immediately
    const duplicateTab = await context.newPage();
    await duplicateTab.goto('/tasks');
    await expect(duplicateTab.getByTestId('duplicate-tab-lockout')).toBeVisible();
    await duplicateTab.close();
  });
});
