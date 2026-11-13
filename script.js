const STORAGE_KEY = 'organisation_management_state_v1';
const ACCOUNTS_STORAGE_KEY = 'organisation_management_accounts_v1';
const AUTH_SESSION_KEY = 'organisation_management_authenticated_v2';
const NOTIFICATIONS_STORAGE_KEY = 'organisation_management_notifications_v1';
const AUTH_ITERATIONS = 250000;
const PREFERENCES_STORAGE_KEY = 'organisation_management_preferences_v1';
const PROFILE_STORAGE_KEY = 'organisation_management_profile_v1';
const IMAGE_FALLBACK_SOURCE = 'positive-youngminds-illustration.svg';
const DEPARTMENT_CATALOG_VERSION = 2;
const STANDARD_DEPARTMENTS = [
  'Administration',
  'Communications',
  'Community Outreach',
  'Finance',
  'Fundraising',
  'Human Resources',
  'Information Technology',
  'Monitoring & Evaluation',
  'Operations',
  'Programmes',
  'Youth Development'
];
const DEFAULT_PREFERENCES = {
  theme: 'light',
  textSize: 'normal',
  highContrast: false,
  reduceMotion: false,
  largeTargets: false
};
let currentAccount = null;
let selectedDepartment = '';
let selectedBeneficiaryDepartment = '';
let state;
let editSessionUnlocked = false;
let pendingEditAction = null;
const EDIT_CODES_STORAGE_KEY = 'organisation_management_edit_codes_v1';
const EDIT_CODE_RESET_REQUESTS_KEY = 'organisation_management_edit_code_reset_requests_v1';

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.getAttribute('src') || image.dataset.imageFallbackApplied) return;
  image.dataset.imageFallbackApplied = 'true';
  image.src = IMAGE_FALLBACK_SOURCE;
  if (!image.alt) image.alt = 'Positive Young Minds illustration';
}, true);

function readPreferences() {
  try {
    const saved = JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) || 'null');
    return {
      theme: saved?.theme === 'dark' ? 'dark' : 'light',
      textSize: ['normal', 'large', 'x-large'].includes(saved?.textSize) ? saved.textSize : 'normal',
      highContrast: saved?.highContrast === true,
      reduceMotion: saved?.reduceMotion === true,
      largeTargets: saved?.largeTargets === true
    };
  } catch (error) {
    return { ...DEFAULT_PREFERENCES };
  }
}

function applyPreferences(preferences) {
  document.documentElement.dataset.theme = preferences.theme;
  document.documentElement.dataset.textSize = preferences.textSize;
  document.body.classList.toggle('high-contrast', preferences.highContrast);
  document.body.classList.toggle('reduce-motion', preferences.reduceMotion);
  document.body.classList.toggle('large-targets', preferences.largeTargets);
}

let preferences = readPreferences();
applyPreferences(preferences);

function readAdminProfile() {
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_STORAGE_KEY) || 'null');
    return {
      name: typeof saved?.name === 'string' && saved.name.trim() ? saved.name : 'Main overseer',
      email: typeof saved?.email === 'string' ? saved.email : '',
      photo: typeof saved?.photo === 'string' ? saved.photo : ''
    };
  } catch (error) {
    return { name: 'Main overseer', email: '', photo: '' };
  }
}

let adminProfile = readAdminProfile();

const authScreen = document.getElementById('auth-screen');
const authForm = document.getElementById('auth-form');
const authName = document.getElementById('auth-name');
const authNameLabel = document.getElementById('auth-name-label');
const authEmail = document.getElementById('auth-email');
const authEmailLabel = document.getElementById('auth-email-label');
const authPhotoInput = document.getElementById('auth-photo');
const authPhotoLabel = document.getElementById('auth-photo-label');
const authAvatar = document.getElementById('auth-avatar');
const authAvatarImage = document.getElementById('auth-avatar-image');
const authPassword = document.getElementById('auth-password');
const authConfirmPassword = document.getElementById('auth-confirm-password');
const authConfirmLabel = document.getElementById('auth-confirm-label');
const authTitle = document.getElementById('auth-title');
const authDescription = document.getElementById('auth-description');
const authSubmit = document.getElementById('auth-submit');
const authError = document.getElementById('auth-error');
let authPhotoData = '';

function showAuthAvatar(photo, name = 'Account') {
  authAvatar.hidden = !photo;
  if (photo) {
    authAvatarImage.src = photo;
    authAvatarImage.alt = `${name}'s profile picture`;
  } else {
    authAvatarImage.removeAttribute('src');
    authAvatarImage.alt = 'Account profile picture';
  }
}

function bytesToHex(bytes) {
  return Array.from(new Uint8Array(bytes), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function passwordHash(password, salt, iterations = AUTH_ITERATIONS) {
  if (!globalThis.crypto?.subtle || !globalThis.crypto?.getRandomValues) {
    throw new Error('Password protection is unavailable in this browser. Open the file in a current version of Edge, Chrome, or Firefox.');
  }
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({
    name: 'PBKDF2',
    salt,
    iterations,
    hash: 'SHA-256'
  }, key, 256);
  return bytesToHex(bits);
}

function equalHash(left, right) {
  if (left.length !== right.length) return false;
  let difference = 0;
  for (let index = 0; index < left.length; index += 1) {
    difference |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }
  return difference === 0;
}

function readAccounts() {
  const accounts = JSON.parse(localStorage.getItem(ACCOUNTS_STORAGE_KEY) || '[]');
  if (!Array.isArray(accounts)) throw new Error('Saved account data is invalid.');
  return accounts;
}

async function createPasswordAuth(password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  return {
    salt: bytesToHex(salt),
    hash: await passwordHash(password, salt),
    iterations: AUTH_ITERATIONS
  };
}

function editCodeIdentity(account = currentAccount) {
  if (!account) throw new Error('Sign in before setting an edit code.');
  const accountId = String(account.id || '');
  return accountId || `${account.role}:${String(account.email || '').trim().toLowerCase()}`;
}

function readEditCodeData() {
  const saved = JSON.parse(localStorage.getItem(EDIT_CODES_STORAGE_KEY) || '{}');
  if (!saved || typeof saved !== 'object' || Array.isArray(saved)) {
    throw new Error('Saved edit-code data is invalid.');
  }
  return saved;
}

function readEditCodeResetRequests() {
  const saved = JSON.parse(localStorage.getItem(EDIT_CODE_RESET_REQUESTS_KEY) || '[]');
  if (!Array.isArray(saved) || saved.some((identity) => typeof identity !== 'string')) {
    throw new Error('Saved edit-code reset requests are invalid.');
  }
  return saved;
}

function hasEditCode(account = currentAccount) {
  return Boolean(readEditCodeData()[editCodeIdentity(account)]);
}

async function verifyEditCode(code) {
  const auth = readEditCodeData()[editCodeIdentity()];
  if (!auth || !/^[0-9a-f]{32}$/i.test(auth.salt || '') || !/^[0-9a-f]{64}$/i.test(auth.hash || '')
    || !Number.isInteger(auth.iterations) || auth.iterations < 100000 || auth.iterations > 1000000) {
    throw new Error('Your edit code is not set up. Set one in My profile first.');
  }
  const salt = Uint8Array.from(auth.salt.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
  if (!equalHash(await passwordHash(code, salt, auth.iterations), auth.hash)) {
    throw new Error('That edit code is incorrect.');
  }
}

function openEditVerificationDialog() {
  const dialog = document.getElementById('edit-verification-dialog');
  const codeLabel = document.getElementById('edit-verification-code-label');
  const verifyButton = dialog.querySelector('button[type="submit"]');
  const setupButton = document.getElementById('open-edit-code-profile');
  const description = document.getElementById('edit-verification-description');
  const message = document.getElementById('edit-verification-message');
  let hasCode = false;
  description.textContent = '';
  try {
    hasCode = hasEditCode();
  } catch (error) {
    description.textContent = error instanceof Error ? error.message : 'Could not load your edit code.';
  }
  codeLabel.hidden = !hasCode;
  verifyButton.hidden = !hasCode;
  setupButton.hidden = hasCode;
  if (!description.textContent || description.textContent === 'Enter your six-digit edit code to continue.'
    || description.textContent === 'Set up an edit code in My profile before making changes.') {
    description.textContent = hasCode
      ? 'Enter your six-digit edit code to continue.'
      : 'Set up an edit code in My profile before making changes.';
  }
  message.hidden = true;
  dialog.showModal();
  if (hasCode) dialog.querySelector('[name="code"]').focus();
}

function resumePendingEditAction() {
  const pending = pendingEditAction;
  pendingEditAction = null;
  if (!pending) return;
  if (pending.type === 'submit') {
    if (pending.form.isConnected) {
      if (pending.submitter?.form === pending.form) pending.form.requestSubmit(pending.submitter);
      else pending.form.requestSubmit();
    }
  } else if (pending.type === 'change' && pending.target.isConnected) {
    pending.target.dispatchEvent(new Event('change', { bubbles: true }));
  } else if (pending.type === 'click' && pending.target.isConnected) {
    pending.target.click();
  }
}

document.addEventListener('submit', (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)
    || ['auth-form', 'contact-form', 'edit-code-form', 'edit-verification-form'].includes(form.id)
    || editSessionUnlocked) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!pendingEditAction) {
    pendingEditAction = { type: 'submit', form, submitter: event.submitter };
    openEditVerificationDialog();
  }
}, true);

document.addEventListener('change', (event) => {
  if (editSessionUnlocked || !(
    event.target instanceof HTMLInputElement && event.target.id === 'import-data'
    || event.target instanceof HTMLSelectElement && event.target.closest('#accessibility-form')
    || event.target instanceof HTMLInputElement && event.target.closest('#accessibility-form')
  )) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!pendingEditAction) {
    pendingEditAction = { type: 'change', target: event.target };
    openEditVerificationDialog();
  }
}, true);

document.addEventListener('click', (event) => {
  if (editSessionUnlocked || !(event.target instanceof Element)) return;
  const action = event.target.closest(
    '#remove-admin-photo, #mark-all-notifications-read, #dismiss-announcement, #notification-list [data-read-notification], #user-table [data-reset-edit-code], #department-table [data-remove-department], #clock-out-button'
  );
  if (!action) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  if (!pendingEditAction) {
    pendingEditAction = { type: 'click', target: action };
    openEditVerificationDialog();
  }
}, true);

const editVerificationForm = document.getElementById('edit-verification-form');
editVerificationForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const input = editVerificationForm.elements.namedItem('code');
  const message = document.getElementById('edit-verification-message');
  try {
    await verifyEditCode(input.value);
    editSessionUnlocked = true;
    input.value = '';
    document.getElementById('edit-verification-dialog').close();
    resumePendingEditAction();
  } catch (error) {
    message.textContent = error instanceof Error ? error.message : 'Could not verify the edit code.';
    input.value = '';
    message.hidden = false;
  }
});

function cancelPendingEditAction() {
  if (pendingEditAction?.type === 'change') {
    if (pendingEditAction.target.id === 'import-data') pendingEditAction.target.value = '';
    else if (pendingEditAction.target.closest('#accessibility-form')) syncAccessibilityForm();
  }
  pendingEditAction = null;
  editVerificationForm.reset();
}

document.getElementById('cancel-edit-verification').addEventListener('click', cancelPendingEditAction);
document.getElementById('close-edit-verification').addEventListener('click', () => {
  document.getElementById('edit-verification-dialog').close();
  cancelPendingEditAction();
});
document.getElementById('edit-verification-dialog').addEventListener('cancel', cancelPendingEditAction);
document.getElementById('open-edit-code-profile').addEventListener('click', () => {
  document.getElementById('edit-verification-dialog').close();
  openWorkflowDialog('profile-dialog');
});

function setAuthMode(mode) {
  const setup = mode === 'setup';
  authNameLabel.hidden = !setup;
  authPhotoLabel.hidden = !setup;
  authName.required = setup;
  authEmailLabel.hidden = false;
  authEmail.type = 'email';
  authEmail.required = true;
  authConfirmLabel.hidden = !setup;
  authConfirmPassword.required = setup;
  authPassword.required = true;
  authPassword.minLength = 8;
  authPassword.autocomplete = setup ? 'new-password' : 'current-password';
  authEmail.autocomplete = 'username';
  authTitle.textContent = setup ? 'Create the main overseer account' : 'Welcome back';
  authDescription.textContent = setup
    ? 'The first account is the main overseer and can manage users and view all changes.'
    : 'Sign in with your email and password.';
  authSubmit.textContent = setup ? 'Create account' : 'Sign in';
  if (setup) showAuthAvatar(authPhotoData, authName.value.trim() || 'Main overseer');
  authForm.dataset.mode = mode;
  authError.hidden = true;
  authError.textContent = '';
}

function showAuthScreen() {
  sessionStorage.removeItem(AUTH_SESSION_KEY);
  currentAccount = null;
  editSessionUnlocked = false;
  authScreen.hidden = false;
  document.querySelector('.page-shell').inert = true;
  authEmail.value = '';
  authPassword.value = '';
  authConfirmPassword.value = '';
  authName.value = '';
  authPhotoInput.value = '';
  authPhotoData = '';
  showAuthAvatar('', 'Account');
  let hasAccounts = false;
  try {
    hasAccounts = readAccounts().length > 0;
  } catch (error) {
    authError.textContent = 'Browser storage is unavailable. Enable local storage for this file to use the password lock.';
    authError.hidden = false;
    setAuthMode('login');
    return;
  }
  setAuthMode(hasAccounts ? 'login' : 'setup');
  (hasAccounts ? authEmail : authName).focus();
}

function unlockApp(account) {
  selectedDepartment = '';
  selectedBeneficiaryDepartment = '';
  currentAccount = account;
  editSessionUnlocked = false;
  sessionStorage.setItem(AUTH_SESSION_KEY, account.email);
  authScreen.hidden = true;
  document.querySelector('.page-shell').inert = false;
  applyAccountAccess();
  startAutomaticClockIn();
  renderAll();
}

authForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  authError.hidden = true;
  authSubmit.disabled = true;
  try {
    const email = authEmail.value.trim().toLowerCase();
    const password = authPassword.value;
    if (password.length < 8) {
      throw new Error('Use a password with at least 8 characters.');
    }

    if (authForm.dataset.mode === 'setup') {
      const name = authName.value.trim();
      if (!name || !email) throw new Error('Enter your name and email address.');
      if (password !== authConfirmPassword.value) {
        throw new Error('The passwords do not match.');
      }
      const account = {
        id: crypto.randomUUID(),
        name,
        email,
        department: '',
        role: 'main_overseer',
        photo: authPhotoData,
        ...(await createPasswordAuth(password))
      };
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify([account]));
      currentAccount = account;
      const previousAuditLength = state.auditLog.length;
      state.auditLog.push(createAuditEntry('Created the main overseer account'));
      try {
        saveState();
      } catch (error) {
        state.auditLog.length = previousAuditLength;
        localStorage.removeItem(ACCOUNTS_STORAGE_KEY);
        currentAccount = null;
        throw new Error('Could not save your account and its change history. Check available browser storage.');
      }
      unlockApp(account);
      return;
    }

    const account = readAccounts().find((item) => item.email.toLowerCase() === email);
    showAuthAvatar(account?.photo || '', account?.name || 'Account');
    if (!account || !/^[0-9a-f]{32}$/i.test(account.salt || '') || !/^[0-9a-f]{64}$/i.test(account.hash || '')
      || !Number.isInteger(account.iterations) || account.iterations < 100000 || account.iterations > 1000000) {
      throw new Error('Email or password is incorrect.');
    }
    const salt = Uint8Array.from(account.salt.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
    const enteredHash = await passwordHash(password, salt, account.iterations);
    if (!equalHash(enteredHash, account.hash)) throw new Error('Email or password is incorrect.');
    unlockApp(account);
  } catch (error) {
    authError.textContent = error instanceof Error ? error.message : 'Could not verify the password.';
    authError.hidden = false;
  } finally {
    authSubmit.disabled = false;
  }
});

authEmail.addEventListener('input', () => {
  if (authForm.dataset.mode !== 'login') return;
  const email = authEmail.value.trim().toLowerCase();
  const account = readAccounts().find((item) => item.email.toLowerCase() === email);
  showAuthAvatar(account?.photo || '', account?.name || 'Account');
});

authPhotoInput.addEventListener('change', async () => {
  const file = authPhotoInput.files[0];
  if (!file) {
    authPhotoData = '';
    showAuthAvatar('', 'Main overseer');
    return;
  }
  try {
    authPhotoData = await resizeProfilePhoto(file);
    showAuthAvatar(authPhotoData, authName.value.trim() || 'Main overseer');
  } catch (error) {
    authPhotoInput.value = '';
    authPhotoData = '';
    showAuthAvatar('', 'Main overseer');
    authError.textContent = error instanceof Error ? error.message : 'Could not load the profile picture.';
    authError.hidden = false;
  }
});

document.getElementById('lock-app').addEventListener('click', () => {
  showAuthScreen();
  renderAll();
});

try {
  sessionStorage.removeItem('organisation_management_authenticated');
  sessionStorage.removeItem('organisation_management_auth_context');
  const sessionEmail = sessionStorage.getItem(AUTH_SESSION_KEY);
  const sessionAccount = sessionEmail && readAccounts().find((account) => account.email === sessionEmail);
  if (sessionAccount) {
    currentAccount = sessionAccount;
    authScreen.hidden = true;
    document.querySelector('.page-shell').inert = false;
  } else showAuthScreen();
} catch (error) {
  authScreen.hidden = false;
  document.querySelector('.page-shell').inert = true;
  setAuthMode('login');
  authError.textContent = 'Session storage is unavailable. Enable browser storage to use the password lock.';
  authError.hidden = false;
}

const DEFAULT_STATE = {
  auditLog: [],
  departmentCatalogVersion: DEPARTMENT_CATALOG_VERSION,
  departments: [...STANDARD_DEPARTMENTS],
  people: [
    { id: 1, name: 'Amina Ndlovu', role: 'volunteer', email: 'amina@example.org', phone: '555-0101' },
    { id: 2, name: 'Joseph Mokoena', role: 'staff', email: 'joseph@innovise.com', phone: '555-0102' },
    { id: 3, name: 'Eliana Gomez', role: 'staff', email: 'eliana@innovise.com', phone: '555-0103' }
  ],
  attendance: [
    { id: 1, personId: 1, attendedOn: '2026-11-10', status: 'present' },
    { id: 2, personId: 2, attendedOn: '2026-11-10', status: 'late' }
  ],
  responsibilities: [
    { id: 1, personId: 1, description: 'Welcome desk', dueDate: '2026-12-01' },
    { id: 2, personId: 2, description: 'Project review', dueDate: '2026-11-15' }
  ],
  projects: [
    { id: 1, name: 'Community Garden', description: 'Urban gardening project', budget: 12000, deadline: '2026-12-15' }
  ],
  tasks: [
    { id: 1, projectId: 1, title: 'Prepare site', dueDate: '2026-11-25', status: 'in_progress' },
    { id: 2, projectId: 1, title: 'Order materials', dueDate: '2026-11-18', status: 'pending' }
  ],
  reports: [
    { id: 1, projectId: 1, report: 'Site preparation is underway.', createdAt: '2026-11-10' }
  ],
  records: [
    { id: 1, title: 'Volunteer Policy', category: 'policy', description: 'Updated volunteer onboarding policy', originalName: 'volunteer-policy.pdf', createdAt: '2026-11-10', fileData: '' }
  ]
};

state = loadState();
let lastSavedData = snapshotData();

function getDepartmentOptions() {
  const savedDepartments = [
    ...(state?.people || []).map((person) => person.department),
    ...(state?.projects || []).map((project) => project.department),
    ...(state?.records || []).map((record) => record.department),
    ...readAccounts().map((account) => account.department),
    currentAccount?.department
  ].map((department) => String(department || '').trim()).filter(Boolean);
  return [...new Set([...(state?.departments || STANDARD_DEPARTMENTS), ...savedDepartments])]
    .sort((left, right) => left.localeCompare(right));
}

function populateDepartmentSelect(select, placeholder = 'Choose a department') {
  if (!(select instanceof HTMLSelectElement)) return;
  const selectedDepartment = select.value;
  const departments = getDepartmentOptions();
  select.innerHTML = `<option value="">${escapeHtml(placeholder)}</option>` + departments.map((department) => (
    `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`
  )).join('');
  if (departments.includes(selectedDepartment)) select.value = selectedDepartment;
}

function snapshotData() {
  return JSON.stringify({
    departments: state?.departments,
    people: state?.people,
    attendance: state?.attendance,
    responsibilities: state?.responsibilities,
    projects: state?.projects,
    tasks: state?.tasks,
    reports: state?.reports,
    records: state?.records
  });
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return structuredClone(DEFAULT_STATE);
    const departments = Array.isArray(saved.departments)
      ? saved.departments.filter((department) => typeof department === 'string')
      : [...STANDARD_DEPARTMENTS];
    const savedDepartmentCatalogVersion = Number(saved.departmentCatalogVersion) || 1;
    if (savedDepartmentCatalogVersion < DEPARTMENT_CATALOG_VERSION
      && !departments.some((department) => department.toLowerCase() === 'community outreach')) {
      departments.push('Community Outreach');
    }
    return {
      people: Array.isArray(saved.people) ? saved.people : DEFAULT_STATE.people,
      departmentCatalogVersion: DEPARTMENT_CATALOG_VERSION,
      departments,
      auditLog: Array.isArray(saved.auditLog) ? saved.auditLog : [],
      attendance: Array.isArray(saved.attendance) ? saved.attendance : DEFAULT_STATE.attendance,
      responsibilities: Array.isArray(saved.responsibilities) ? saved.responsibilities : DEFAULT_STATE.responsibilities,
      projects: Array.isArray(saved.projects) ? saved.projects : DEFAULT_STATE.projects,
      tasks: Array.isArray(saved.tasks) ? saved.tasks : DEFAULT_STATE.tasks,
      reports: Array.isArray(saved.reports) ? saved.reports : DEFAULT_STATE.reports,
      records: Array.isArray(saved.records) ? saved.records : DEFAULT_STATE.records
    };
  } catch (error) {
    return structuredClone(DEFAULT_STATE);
  }
}

function saveState() {
  const previous = JSON.parse(lastSavedData);
  const changes = [];
  for (const collection of ['people', 'attendance', 'responsibilities', 'projects', 'tasks', 'reports', 'records']) {
    const before = previous[collection] || [];
    const after = state[collection] || [];
    const beforeById = new Map(before.map((item) => [String(item.id), item]));
    const afterById = new Map(after.map((item) => [String(item.id), item]));
    for (const item of after) {
      const oldItem = beforeById.get(String(item.id));
      if (!oldItem) changes.push(`${collectionLabel(collection)}: added ${itemLabel(collection, item)}`);
      else if (JSON.stringify(oldItem) !== JSON.stringify(item)) {
        const fields = [...new Set([...Object.keys(oldItem), ...Object.keys(item)])]
          .filter((key) => JSON.stringify(oldItem[key]) !== JSON.stringify(item[key]));
        changes.push(`${collectionLabel(collection)}: updated ${itemLabel(collection, item)} (changed: ${fields.join(', ')})`);
      }
    }
    for (const item of before) {
      if (!afterById.has(String(item.id))) changes.push(`${collectionLabel(collection)}: removed ${itemLabel(collection, item)}`);
    }
  }
  const newEntries = changes.map((change) => createAuditEntry(change));
  state.auditLog.push(...newEntries);
  state.auditLog = state.auditLog.slice(-1000);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    lastSavedData = snapshotData();
  } catch (error) {
    state.auditLog.splice(Math.max(0, state.auditLog.length - newEntries.length), newEntries.length);
    throw error;
  }
}

function collectionLabel(collection) {
  return ({
    people: 'Member',
    attendance: 'Attendance',
    responsibilities: 'Responsibility',
    projects: 'Project',
    tasks: 'Task',
    reports: 'Progress report',
    records: 'Document'
  })[collection] || collection;
}

function itemLabel(collection, item) {
  if (collection === 'people' || collection === 'projects' || collection === 'tasks' || collection === 'records') {
    return `"${item.name || item.title || 'Untitled'}"`;
  }
  if (collection === 'attendance') {
    return item.personId
      ? `for person #${item.personId}`
      : `for account ${item.accountEmail || item.accountName || 'unknown'}`;
  }
  if (collection === 'responsibilities') return `for person #${item.personId}`;
  if (collection === 'reports') return `for project #${item.projectId}`;
  return `#${item.id}`;
}

function createAuditEntry(change) {
  return {
    id: crypto.randomUUID(),
    changedAt: new Date().toISOString(),
    actorName: currentAccount?.name || 'Initial setup',
    actorEmail: currentAccount?.email || '',
    change
  };
}

function isOverseer() {
  return currentAccount?.role === 'main_overseer';
}

function departmentMatches(item) {
  if (!currentAccount) return false;
  if (isOverseer()) {
    return !selectedDepartment || String(item.department || '').trim().toLowerCase()
      === selectedDepartment.trim().toLowerCase();
  }
  return Boolean(currentAccount.department) && String(item.department || '').trim().toLowerCase()
    === String(currentAccount.department).trim().toLowerCase();
}

function visiblePeople() {
  return state.people.filter(departmentMatches);
}

function visibleProjects() {
  return state.projects.filter(departmentMatches);
}

function visibleProjectIds() {
  return new Set(visibleProjects().map((project) => Number(project.id)));
}

function uniqueId(collection) {
  return collection.reduce((max, item) => Math.max(max, Number(item.id) || 0), 0) + 1;
}

function getPersonById(personId) {
  return state.people.find((person) => Number(person.id) === Number(personId));
}

function getVisiblePersonById(personId) {
  const person = getPersonById(personId);
  return person && departmentMatches(person) ? person : undefined;
}

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function currentAttendanceMember() {
  if (!currentAccount) return undefined;
  const memberId = Number(currentAccount.memberId);
  if (Number.isFinite(memberId) && memberId > 0) {
    const linkedMember = getPersonById(memberId);
    if (linkedMember && linkedMember.role !== 'beneficiary' && departmentMatches(linkedMember)) return linkedMember;
  }
  const email = String(currentAccount.email || '').trim().toLowerCase();
  return email ? state.people.find((person) => (
    person.role !== 'beneficiary'
    && String(person.email || '').trim().toLowerCase() === email
    && departmentMatches(person)
  )) : undefined;
}

function currentAttendanceEntry(date, member = currentAttendanceMember()) {
  if (!currentAccount) return undefined;
  const accountEmail = String(currentAccount.email || '').trim().toLowerCase();
  const accountId = editCodeIdentity(currentAccount);
  return state.attendance.find((entry) => {
    if (entry.attendedOn !== date) return false;
    if (member && Number(entry.personId) === Number(member.id)) return true;
    if (accountEmail) return String(entry.accountEmail || '').trim().toLowerCase() === accountEmail;
    return Boolean(accountId) && String(entry.accountId || '') === accountId;
  });
}

function attendanceEntryVisible(entry) {
  const personId = Number(entry.personId);
  if (entry.personId !== null && entry.personId !== undefined && entry.personId !== ''
    && Number.isFinite(personId)) {
    const person = getVisiblePersonById(personId);
    return Boolean(person && person.role !== 'beneficiary');
  }
  return departmentMatches({ department: entry.department });
}

function formatClockTime(timestamp) {
  const date = new Date(timestamp);
  return Number.isNaN(date.getTime()) ? '—' : date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

function startAutomaticClockIn() {
  const errorMessage = document.getElementById('attendance-clock-error');
  errorMessage.hidden = true;
  if (!currentAccount) return;
  const member = currentAttendanceMember();
  const today = localDateString();
  const existing = currentAttendanceEntry(today, member);
  if (existing?.clockIn || existing?.clockOut) return;

  const now = new Date().toISOString();
  const previous = existing ? { ...existing } : null;
  const accountEmail = String(currentAccount.email || '').trim().toLowerCase();
  const attendanceIdentity = {
    accountId: editCodeIdentity(currentAccount),
    accountEmail,
    accountName: String(currentAccount.name || accountEmail || 'Account'),
    department: String(member?.department || currentAccount.department || '')
  };
  if (existing) {
    Object.assign(existing, attendanceIdentity);
    existing.clockIn = now;
    if (!existing.status) existing.status = 'present';
  } else {
    state.attendance.push({
      id: uniqueId(state.attendance),
      personId: member?.id ?? null,
      ...attendanceIdentity,
      attendedOn: today,
      status: 'present',
      clockIn: now,
      clockOut: ''
    });
  }

  try {
    saveState();
  } catch (error) {
    if (existing) {
      Object.assign(existing, previous);
    } else {
      state.attendance.pop();
    }
    const message = document.getElementById('attendance-clock-error');
    message.textContent = error instanceof Error ? error.message : 'Could not save your automatic clock-in.';
    message.hidden = false;
  }
}

function getProjectById(projectId) {
  return state.projects.find((project) => Number(project.id) === Number(projectId));
}

function getVisibleProjectById(projectId) {
  const project = getProjectById(projectId);
  return project && departmentMatches(project) ? project : undefined;
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[character]);
}

function formatRole(role) {
  const knownRoles = {
    staff: 'Staff',
    volunteer: 'Volunteer',
    beneficiary: 'Beneficiary',
    administrator: 'Administrator',
    manager: 'Manager',
    coordinator: 'Coordinator',
    project_lead: 'Project Lead',
    finance_officer: 'Finance Officer',
    intern: 'Intern'
  };
  return knownRoles[role] || role;
}

function formatQualification(qualification) {
  const knownQualifications = {
    grade_10: 'Grade 10',
    grade_11: 'Grade 11',
    grade_12: 'Grade 12 / Matric',
    certificate: 'Certificate',
    diploma: 'Diploma',
    degree: 'Degree'
  };
  return knownQualifications[qualification] || qualification || '—';
}

function profileAvatar(person, className) {
  if (person.photo) {
    return `<img class="avatar-photo small ${className}" src="${escapeHtml(person.photo)}" alt="${escapeHtml(person.name)}'s profile picture">`;
  }
  return `<span class="avatar small ${className}"></span>`;
}

function resizeProfilePhoto(file) {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('Choose an image file for the profile picture.'));
  }
  if (file.size > 10 * 1024 * 1024) {
    return Promise.reject(new Error('Choose an image smaller than 10 MB.'));
  }

  return new Promise((resolve, reject) => {
    const imageUrl = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(imageUrl);
      const maxDimension = 256;
      const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
      const canvas = document.createElement('canvas');
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      const context = canvas.getContext('2d');
      if (!context) {
        reject(new Error('Could not process this image. Please try another file.'));
        return;
      }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL('image/jpeg', 0.82));
    };
    image.onerror = () => {
      URL.revokeObjectURL(imageUrl);
      reject(new Error('Could not open this image. Please try another file.'));
    };
    image.src = imageUrl;
  });
}

function setActiveTab(tabName) {
  if (['audit', 'beneficiaries'].includes(tabName) && !isOverseer()) return;
  document.querySelectorAll('.nav-item[data-tab]').forEach((item) => {
    item.classList.toggle('active', item.dataset.tab === tabName);
  });

  document.querySelectorAll('.tab-panel').forEach((panel) => {
    panel.classList.toggle('active', panel.id === tabName);
  });
}

function setSelectedDepartment(department) {
  if (!isOverseer()) return;
  const requestedDepartment = String(department || '').trim();
  selectedDepartment = getDepartmentOptions().find((item) => (
    item.toLowerCase() === requestedDepartment.toLowerCase()
  )) || '';
  renderAll();
}

function renderDepartmentFilters() {
  const departments = getDepartmentOptions();
  if (selectedDepartment && !departments.includes(selectedDepartment)) selectedDepartment = '';

  const select = document.getElementById('project-department-filter');
  select.innerHTML = '<option value="">All departments</option>' + departments.map((department) => (
    `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`
  )).join('');
  select.value = selectedDepartment;
}

function renderDashboardSummary() {
  const people = visiblePeople().filter((person) => person.role !== 'beneficiary');
  const projectIds = visibleProjectIds();
  const projects = visibleProjects();
  const total = people.length;
  const newPeople = people.filter((person) => person.role !== 'volunteer').length;
  const volunteers = total - newPeople;

  document.getElementById('total-employee').textContent = total;
  document.getElementById('new-employee').textContent = newPeople;
  document.getElementById('resigned-employee').textContent = volunteers;
  document.getElementById('dashboard-program-count').textContent = projects
    .filter((project) => !['completed', 'cancelled'].includes(project.status))
    .length;
  document.getElementById('dashboard-open-task-count').textContent = state.tasks
    .filter((task) => projectIds.has(Number(task.projectId)) && task.status !== 'done')
    .length;
  document.getElementById('dashboard-report-count').textContent = state.reports
    .filter((report) => projectIds.has(Number(report.projectId)))
    .length;

  const tbody = document.getElementById('dashboard-people-table');
  tbody.innerHTML = people.slice(0, 4).map((person) => `
    <tr>
      <td>
        <div class="person-cell">
          ${profileAvatar(person, ['a1', 'a2', 'a3', 'a4'][Math.abs(person.id) % 4])}
          <div>
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml(person.email || 'No email provided')}</small>
          </div>
        </div>
      </td>
      <td>${escapeHtml(formatRole(person.role))}</td>
      <td>${escapeHtml(person.email || '—')}</td>
      <td>${escapeHtml(person.phone || '—')}</td>
      <td><span class="tag ${person.role === 'volunteer' ? 'tag-pending' : 'tag-inprogress'}">${person.role === 'volunteer' ? 'Volunteer' : 'Active'}</span></td>
    </tr>
  `).join('');
}

function renderDashboardBeneficiaries() {
  const departmentNames = getDepartmentOptions().filter((department) => (
    departmentMatches({ department })
  ));
  const projects = visibleProjects();
  const hasUnassignedProjects = isOverseer() && !selectedDepartment
    && projects.some((project) => !String(project.department || '').trim());
  if (hasUnassignedProjects) departmentNames.push('Unassigned department');

  if (!departmentNames.includes(selectedBeneficiaryDepartment)) {
    selectedBeneficiaryDepartment = !isOverseer() && departmentNames.length === 1
      ? departmentNames[0]
      : selectedDepartment && departmentNames.includes(selectedDepartment)
        ? selectedDepartment
        : '';
  }

  const select = document.getElementById('beneficiary-department-filter');
  select.innerHTML = '<option value="">Choose a department</option>' + departmentNames.map((department) => (
    `<option value="${escapeHtml(department)}">${escapeHtml(department)}</option>`
  )).join('');
  select.value = selectedBeneficiaryDepartment;

  const container = document.getElementById('beneficiaries-by-department');
  if (!selectedBeneficiaryDepartment) {
    container.innerHTML = '<p class="beneficiary-empty">Select a department to view its beneficiary details.</p>';
    return;
  }

  const selectedIsUnassigned = selectedBeneficiaryDepartment === 'Unassigned department';
  const departmentProjects = projects.filter((project) => (
    selectedIsUnassigned
      ? !String(project.department || '').trim()
      : String(project.department || '').trim().toLowerCase() === selectedBeneficiaryDepartment.toLowerCase()
  ));
  const beneficiaryProfiles = visiblePeople().filter((person) => (
    person.role === 'beneficiary'
    && (selectedIsUnassigned
      ? !String(person.department || '').trim()
      : String(person.department || '').trim().toLowerCase() === selectedBeneficiaryDepartment.toLowerCase())
  ));
  container.innerHTML = `
    <article class="beneficiary-department-card">
      <div class="beneficiary-department-header">
        <h3>${escapeHtml(selectedBeneficiaryDepartment)}</h3>
        <span>${beneficiaryProfiles.length} profile${beneficiaryProfiles.length === 1 ? '' : 's'} · ${departmentProjects.length} programme/project${departmentProjects.length === 1 ? '' : 's'}</span>
      </div>
      ${beneficiaryProfiles.length ? `
        <h4>Registered beneficiaries</h4>
        <ul class="beneficiary-project-list">
          ${beneficiaryProfiles.map((person) => `<li><strong>${escapeHtml(person.name)}</strong></li>`).join('')}
        </ul>
      ` : ''}
      ${departmentProjects.length ? `
        <ul class="beneficiary-project-list">
          ${departmentProjects.map((project) => `
            <li>
              <strong>${escapeHtml(project.name || 'Untitled programme / project')}</strong>
              <p class="beneficiary-description">${escapeHtml(String(project.beneficiaries || '').trim() || 'No beneficiary details recorded.')}</p>
            </li>
          `).join('')}
        </ul>
      ` : '<p class="beneficiary-empty">No programmes or projects recorded for this department.</p>'}
    </article>
  `;
}

function renderPeople() {
  const people = visiblePeople();
  const tbody = document.getElementById('people-table');
  tbody.innerHTML = people.map((person) => `
    <tr>
      <td>${person.id}</td>
      <td>
        <div class="person-cell">
          ${profileAvatar(person, ['a1', 'a2', 'a3', 'a4'][Math.abs(person.id) % 4])}
          <div>
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml([person.email, person.phone].filter(Boolean).join(' · ') || 'No contact details')}</small>
          </div>
        </div>
      </td>
      <td>${escapeHtml(formatRole(person.role))}</td>
      <td>${escapeHtml(person.department || '—')}</td>
      <td>${escapeHtml(person.schoolStatus === 'in_school' ? 'In school' : person.schoolStatus === 'out_of_school' ? 'Out of school' : '—')}</td>
      <td>${escapeHtml(formatQualification(person.qualification))}</td>
      <td>
        <div class="member-actions">
          <details class="member-details">
            <summary>Details</summary>
            <dl>
              <dt>ID number</dt><dd>${escapeHtml(person.idNumber || '—')}</dd>
              <dt>Date of birth</dt><dd>${escapeHtml(person.dateOfBirth || '—')}</dd>
              <dt>Gender</dt><dd>${escapeHtml(person.gender ? person.gender.replaceAll('_', ' ') : '—')}</dd>
              <dt>Address (area)</dt><dd>${escapeHtml(person.address || '—')}</dd>
              <dt>School status</dt><dd>${escapeHtml(person.schoolStatus === 'in_school' ? 'In school' : person.schoolStatus === 'out_of_school' ? 'Out of school' : '—')}</dd>
              <dt>Highest qualification</dt><dd>${escapeHtml(formatQualification(person.qualification))}</dd>
              <dt>Why they want to join</dt><dd>${escapeHtml(person.motivation || '—')}</dd>
              <dt>Disability / health condition</dt><dd>${escapeHtml(person.healthCondition || '—')}</dd>
              <dt>Documents</dt><dd>${['cv', 'idCopy', 'matricCertificate'].map((type) => {
                const file = person.documents?.[type];
                if (!file?.name) return '';
                const labels = { cv: 'CV', idCopy: 'ID copy', matricCertificate: 'Matric certificate' };
                return `<button type="button" class="table-action" data-download-person-document="${person.id}" data-document-type="${type}">${labels[type]}: ${escapeHtml(file.name)}</button>`;
              }).filter(Boolean).join(' ') || '—'}</dd>
            </dl>
          </details>
          <button class="table-action" type="button" data-edit-person="${person.id}">Edit</button>
        </div>
      </td>
    </tr>
  `).join('');

  const attendanceTbody = document.getElementById('attendance-table');
  attendanceTbody.innerHTML = state.attendance.filter(attendanceEntryVisible).map((entry) => {
    const person = getPersonById(entry.personId);
    return `
      <tr>
        <td>${entry.id}</td>
        <td>${escapeHtml(person?.name || entry.accountName || entry.accountEmail || `Person ${entry.personId}`)}</td>
        <td>${escapeHtml(entry.attendedOn)}</td>
        <td>${escapeHtml(entry.clockIn ? formatClockTime(entry.clockIn) : '—')}</td>
        <td>${escapeHtml(entry.clockOut ? formatClockTime(entry.clockOut) : '—')}</td>
        <td>${escapeHtml(entry.status)}</td>
      </tr>
    `;
  }).join('');

  const responsibilitiesTbody = document.getElementById('responsibility-table');
  responsibilitiesTbody.innerHTML = state.responsibilities.filter((item) => getVisiblePersonById(item.personId)).map((responsibility) => {
    const person = getPersonById(responsibility.personId);
    return `
      <tr>
        <td>${responsibility.id}</td>
        <td>${escapeHtml(person ? person.name : `Person ${responsibility.personId}`)}</td>
        <td>${escapeHtml(responsibility.description)}</td>
        <td>${escapeHtml(responsibility.dueDate || '—')}</td>
      </tr>
    `;
  }).join('');
}

function renderBeneficiaryProfiles() {
  const tbody = document.getElementById('beneficiaries-table');
  const beneficiaries = visiblePeople().filter((person) => person.role === 'beneficiary');
  tbody.innerHTML = beneficiaries.length ? beneficiaries.map((person) => `
    <tr>
      <td>${person.id}</td>
      <td>
        <div class="person-cell">
          ${profileAvatar(person, ['a1', 'a2', 'a3', 'a4'][Math.abs(person.id) % 4])}
          <div>
            <strong>${escapeHtml(person.name)}</strong>
            <small>${escapeHtml([person.email, person.phone].filter(Boolean).join(' · ') || 'No contact details')}</small>
          </div>
        </div>
      </td>
      <td>${escapeHtml(person.department || '—')}</td>
      <td>${escapeHtml(person.schoolStatus === 'in_school' ? 'In school' : person.schoolStatus === 'out_of_school' ? 'Out of school' : '—')}</td>
      <td>${escapeHtml(formatQualification(person.qualification))}</td>
      <td><button class="table-action" type="button" data-edit-person="${person.id}">Edit profile</button></td>
    </tr>
  `).join('') : '<tr><td colspan="6" class="muted-text">No beneficiary profiles yet. Select “Add beneficiary” to create one.</td></tr>';
}

function renderAttendanceClock() {
  const status = document.getElementById('attendance-clock-status');
  const clockOutButton = document.getElementById('clock-out-button');
  if (!currentAccount) {
    status.textContent = 'Sign in to automatically clock in.';
    clockOutButton.hidden = true;
    return;
  }

  const today = localDateString();
  const entry = currentAttendanceEntry(today);
  if (entry?.clockIn && !entry.clockOut) {
    status.textContent = `Clocked in at ${formatClockTime(entry.clockIn)}. Remember to clock out when your workday ends.`;
    clockOutButton.hidden = false;
  } else if (entry?.clockIn && entry.clockOut) {
    status.textContent = `Today's shift: ${formatClockTime(entry.clockIn)}–${formatClockTime(entry.clockOut)}.`;
    clockOutButton.hidden = true;
  } else {
    status.textContent = 'No clock-in recorded for today.';
    clockOutButton.hidden = true;
  }
}

function renderProjects() {
  const projects = visibleProjects();
  const projectIds = visibleProjectIds();
  const projectTbody = document.getElementById('project-table');
  const programmeTypeLabels = {
    general: 'General programme / project',
    mental_health: 'Mental health awareness',
    youth_development: 'Youth development',
    work_integrated_learning: 'Work-integrated learning (WIL)',
    digital_skills: 'Digital and computer skills training',
    learner_support: 'Learner support and education',
    community_outreach: 'Community outreach',
    other: 'Other'
  };
  const activityTypeLabels = {
    workshop: 'Workshop',
    drive: 'Drive',
    event: 'Event',
    campaign: 'Campaign',
    training: 'Training',
    programme: 'Programme',
    project: 'Project'
  };
  projectTbody.innerHTML = projects.map((project) => `
    <tr>
      <td>${project.photo
        ? `<img class="project-thumbnail" src="${escapeHtml(project.photo)}" alt="${escapeHtml(project.name)} project picture">`
        : '<span class="project-thumbnail-placeholder" aria-label="No project picture">—</span>'}</td>
      <td>${project.id}</td>
      <td>${escapeHtml(project.name)}</td>
      <td>${escapeHtml(activityTypeLabels[project.activityType] || project.activityType || 'Project')}</td>
      <td>${escapeHtml(programmeTypeLabels[project.type] || 'General programme / project')}</td>
      <td><span class="tag ${project.status === 'completed' ? 'tag-inprogress' : project.status === 'on_hold' || project.status === 'cancelled' ? 'tag-pending' : 'tag-inprogress'}">${escapeHtml((project.status || 'planned').replaceAll('_', ' '))}</span></td>
      <td>${Number(project.budget || 0).toLocaleString()}</td>
      <td>${escapeHtml(project.deadline || '—')}</td>
      <td>
        <div class="member-actions">
          <details class="member-details">
            <summary>Details</summary>
            <dl>
              <dt>Activity type</dt><dd>${escapeHtml(activityTypeLabels[project.activityType] || project.activityType || 'Project')}</dd>
              <dt>Programme area</dt><dd>${escapeHtml(programmeTypeLabels[project.type] || 'General programme / project')}</dd>
              <dt>Description</dt><dd>${escapeHtml(project.description || '—')}</dd>
              <dt>Beneficiaries</dt><dd>${escapeHtml(project.beneficiaries || '—')}</dd>
              <dt>Project lead</dt><dd>${escapeHtml(project.lead || '—')}</dd>
              <dt>Location</dt><dd>${escapeHtml(project.address || '—')}</dd>
              <dt>Start date</dt><dd>${escapeHtml(project.startDate || '—')}</dd>
              <dt>Additional notes</dt><dd>${escapeHtml(project.notes || '—')}</dd>
            </dl>
          </details>
          <button class="table-action" type="button" data-edit-project="${project.id}">Edit</button>
        </div>
      </td>
    </tr>
  `).join('');

  const taskTbody = document.getElementById('task-table');
  taskTbody.innerHTML = state.tasks.filter((task) => projectIds.has(Number(task.projectId))).map((task) => {
    const project = getProjectById(task.projectId);
    return `
      <tr>
        <td>${task.id}</td>
        <td>${escapeHtml(project ? project.name : `Project ${task.projectId}`)}</td>
        <td>${escapeHtml(task.title)}</td>
        <td>${escapeHtml(task.dueDate || '—')}</td>
        <td><span class="tag ${task.status === 'done' ? 'tag-inprogress' : task.status === 'in_progress' ? 'tag-inprogress' : 'tag-pending'}">${escapeHtml(task.status)}</span></td>
      </tr>
    `;
  }).join('');

}

function renderReports() {
  const reportTbody = document.getElementById('report-table');
  if (!reportTbody) return;

  const monthFilter = document.getElementById('report-month-filter').value;
  const projectIds = visibleProjectIds();
  const reports = state.reports
    .filter((report) => projectIds.has(Number(report.projectId)))
    .filter((report) => !monthFilter || (report.reportingMonth || String(report.createdAt || '').slice(0, 7)) === monthFilter)
    .sort((left, right) => (
      (right.reportingMonth || String(right.createdAt || '').slice(0, 7))
        .localeCompare(left.reportingMonth || String(left.createdAt || '').slice(0, 7))
      || String(right.createdAt || '').localeCompare(String(left.createdAt || ''))
    ));
  reportTbody.innerHTML = reports.map((report) => {
    const project = getProjectById(report.projectId);
    const reportingMonth = report.reportingMonth || String(report.createdAt || '').slice(0, 7);
    return `
      <tr>
        <td>${report.id}</td>
        <td>${escapeHtml(formatReportMonth(reportingMonth))}</td>
        <td>${escapeHtml(project ? project.name : `Project ${report.projectId}`)}</td>
        <td>${escapeHtml(report.report)}</td>
        <td>${escapeHtml(report.createdAt)}</td>
      </tr>
    `;
  }).join('');
}

function formatReportMonth(value) {
  const match = /^(\d{4})-(\d{2})$/.exec(String(value || ''));
  if (!match) return '—';
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return '—';
  return new Date(year, month - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

function renderRecords() {
  const searchValue = document.getElementById('record-search')?.value.trim().toLowerCase() || '';
  const recordTbody = document.getElementById('record-table');
  const filteredRecords = state.records.filter((record) => departmentMatches(record)).filter((record) => {
    if (!searchValue) return true;
    const haystack = [record.title, record.category, record.description, record.originalName].join(' ').toLowerCase();
    return haystack.includes(searchValue);
  });

  recordTbody.innerHTML = filteredRecords.map((record) => `
    <tr>
      <td>${record.id}</td>
      <td>${escapeHtml(record.title)}</td>
      <td>${escapeHtml(record.category)}</td>
      <td>${escapeHtml(record.department || '—')}</td>
      <td>${escapeHtml(record.description || '—')}</td>
      <td>${record.fileData && record.originalName
        ? `<a class="download-link" href="${escapeHtml(record.fileData)}" download="${escapeHtml(record.originalName)}">Download ${escapeHtml(record.originalName)}</a>`
        : '<span class="muted-text">No file stored</span>'}</td>
      <td>${record.uploadedBy
        ? `${escapeHtml(record.uploadedBy.name || 'Unknown user')}<br><small>${escapeHtml(record.uploadedBy.email || '')}</small>`
        : '<span class="muted-text">Unknown (legacy record)</span>'}</td>
      <td>${escapeHtml(record.createdAt)}</td>
    </tr>
  `).join('');
}

function renderAll() {
  document.querySelectorAll('select[name="department"]').forEach((select) => (
    populateDepartmentSelect(select)
  ));
  renderDepartmentFilters();
  renderDashboardSummary();
  renderDashboardBeneficiaries();
  renderPeople();
  renderBeneficiaryProfiles();
  renderAttendanceClock();
  renderProjects();
  renderReports();
  renderRecords();
  renderAdminProfile();
  renderAuditLog();
  renderAccounts();
  renderDepartmentManagement();
  renderEditCodeSettings();
  renderNotifications();
}

function renderAdminProfile() {
  const profile = currentAccount || adminProfile;
  document.getElementById('admin-display-name').textContent = `Hello, ${profile.name}`;
  document.getElementById('admin-display-email').textContent = profile.email;
  document.getElementById('admin-display-role').textContent = currentAccount
    ? isOverseer() ? `Main overseer · ${selectedDepartment || 'all departments'}` : `${profile.department} department`
    : '';
  const avatarWrap = document.getElementById('admin-avatar-wrap');
  avatarWrap.innerHTML = profile.photo
    ? `<img class="admin-avatar-photo" src="${escapeHtml(profile.photo)}" alt="${escapeHtml(profile.name)}'s profile picture">`
    : '<div class="avatar"></div>';
}

function renderAuditLog() {
  const tbody = document.getElementById('audit-table');
  if (!tbody || !isOverseer()) return;
  tbody.innerHTML = [...state.auditLog].reverse().map((entry) => `
    <tr>
      <td>${escapeHtml(new Date(entry.changedAt).toLocaleString())}</td>
      <td>${escapeHtml(entry.actorName || 'Unknown')}</td>
      <td>${escapeHtml(entry.actorEmail || '—')}</td>
      <td>${escapeHtml(entry.change)}</td>
    </tr>
  `).join('');
}

function renderAccounts() {
  const tbody = document.getElementById('user-table');
  if (!tbody || !isOverseer()) return;
  const resetRequests = readEditCodeResetRequests();
  tbody.innerHTML = readAccounts().map((account) => `
    <tr>
      <td>${escapeHtml(account.name)}</td>
      <td>${escapeHtml(account.email)}</td>
      <td>${account.role === 'main_overseer' ? 'Main overseer — all departments' : escapeHtml(account.department)}</td>
      <td>${hasEditCode(account) ? 'Set' : 'Not set'}</td>
      <td>${resetRequests.includes(editCodeIdentity(account))
        ? `<button class="table-action" type="button" data-reset-edit-code="${escapeHtml(account.id)}">Approve reset</button>`
        : '—'}</td>
    </tr>
  `).join('');
}

function renderDepartmentManagement() {
  const tbody = document.getElementById('department-table');
  if (!tbody || !isOverseer()) return;
  const departments = getDepartmentOptions();
  tbody.innerHTML = departments.length ? departments.map((department) => `
    <tr>
      <td>${escapeHtml(department)}</td>
      <td><button class="table-action" type="button" data-remove-department="${escapeHtml(department)}">Remove</button></td>
    </tr>
  `).join('') : '<tr><td colspan="2">No departments available.</td></tr>';
}

document.getElementById('department-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const message = document.getElementById('department-message');
  const input = event.currentTarget.elements.namedItem('name');
  const department = String(input.value || '').trim();
  if (!isOverseer()) return;
  if (!department) {
    showStatusMessage(message, 'Enter a department name.', true);
    return;
  }
  if (getDepartmentOptions().some((item) => item.toLowerCase() === department.toLowerCase())) {
    showStatusMessage(message, 'That department already exists.', true);
    return;
  }
  const previousDepartments = [...state.departments];
  const previousAuditLength = state.auditLog.length;
  try {
    state.departments.push(department);
    state.auditLog.push(createAuditEntry(`Added department "${department}"`));
    try {
      saveState();
    } catch (error) {
      state.departments = previousDepartments;
      state.auditLog.length = previousAuditLength;
      throw error;
    }
    event.currentTarget.reset();
    renderAll();
    showStatusMessage(message, `Department "${department}" added.`);
  } catch (error) {
    showStatusMessage(message, error instanceof Error ? error.message : 'Could not add the department.', true);
  }
});

document.getElementById('department-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-remove-department]');
  if (!button || !isOverseer()) return;
  const department = getDepartmentOptions().find((item) => item.toLowerCase() === button.dataset.removeDepartment.toLowerCase());
  if (!department) return;

  const matchesDepartment = (value) => String(value || '').trim().toLowerCase() === department.toLowerCase();
  const accountUpdates = readAccounts();
  const affected = {
    people: state.people.filter((person) => matchesDepartment(person.department)).length,
    projects: state.projects.filter((project) => matchesDepartment(project.department)).length,
    records: state.records.filter((record) => matchesDepartment(record.department)).length,
    accounts: accountUpdates.filter((account) => matchesDepartment(account.department)).length
  };
  const previousNotifications = readNotifications();
  const notificationsToRemove = previousNotifications.filter((notification) => (
    notification.type === 'announcement'
    && notification.audience !== 'all'
    && matchesDepartment(notification.department)
  ));
  const assignmentCount = Object.values(affected).reduce((total, count) => total + count, 0);
  const confirmation = `Remove "${department}"? This will clear ${assignmentCount} assignment(s) across staff, projects, records, and accounts, and delete ${notificationsToRemove.length} department-only announcement(s).`;
  if (!confirm(confirmation)) return;

  const previousDepartments = [...state.departments];
  const previousPeople = structuredClone(state.people);
  const previousProjects = structuredClone(state.projects);
  const previousRecords = structuredClone(state.records);
  const previousAuditLength = state.auditLog.length;
  const previousAccountsJson = localStorage.getItem(ACCOUNTS_STORAGE_KEY);
  const previousNotificationsJson = localStorage.getItem(NOTIFICATIONS_STORAGE_KEY);
  let saved = false;
  try {
    state.departments = state.departments.filter((item) => !matchesDepartment(item));
    for (const collection of [state.people, state.projects, state.records]) {
      for (const item of collection) {
        if (matchesDepartment(item.department)) item.department = '';
      }
    }
    const updatedAccounts = accountUpdates.map((account) => (
      matchesDepartment(account.department) ? { ...account, department: '' } : account
    ));
    const keptNotifications = previousNotifications.filter((notification) => (
      notification.type !== 'announcement'
      || notification.audience === 'all'
      || !matchesDepartment(notification.department)
    ));
    state.auditLog.push(createAuditEntry(
      `Removed department "${department}" (cleared ${assignmentCount} assignment(s) and removed ${notificationsToRemove.length} department-only announcement(s))`
    ));
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(updatedAccounts));
    localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(keptNotifications));
    saveState();
    saved = true;
    renderAll();
    showStatusMessage(document.getElementById('department-message'), `Department "${department}" removed.`);
  } catch (error) {
    if (!saved) {
      state.departments = previousDepartments;
      state.people = previousPeople;
      state.projects = previousProjects;
      state.records = previousRecords;
      state.auditLog.length = previousAuditLength;
      if (previousAccountsJson === null) localStorage.removeItem(ACCOUNTS_STORAGE_KEY);
      else localStorage.setItem(ACCOUNTS_STORAGE_KEY, previousAccountsJson);
      if (previousNotificationsJson === null) localStorage.removeItem(NOTIFICATIONS_STORAGE_KEY);
      else localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, previousNotificationsJson);
    }
    showStatusMessage(
      document.getElementById('department-message'),
      saved
        ? `Department was removed, but the page could not refresh: ${error instanceof Error ? error.message : 'Unknown error.'}`
        : error instanceof Error ? error.message : 'Could not remove the department.',
      true
    );
  }
});

document.getElementById('user-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-reset-edit-code]');
  if (!button || !isOverseer()) return;
  const account = readAccounts().find((item) => String(item.id) === button.dataset.resetEditCode);
  if (!account) throw new Error('The requested account no longer exists.');
  const identity = editCodeIdentity(account);
  const requests = readEditCodeResetRequests();
  if (!requests.includes(identity)) return;
  if (!confirm(`The account holder requested this reset. Approve an edit-code reset for ${account.email}?`)) return;

  const previousCodes = readEditCodeData();
  const previousAuditLength = state.auditLog.length;
  try {
    const nextCodes = { ...previousCodes };
    delete nextCodes[identity];
    localStorage.setItem(EDIT_CODES_STORAGE_KEY, JSON.stringify(nextCodes));
    localStorage.setItem(EDIT_CODE_RESET_REQUESTS_KEY, JSON.stringify(requests.filter((item) => item !== identity)));
    state.auditLog.push(createAuditEntry(`Approved edit-code reset for ${account.email}`));
    try {
      saveState();
    } catch (error) {
      localStorage.setItem(EDIT_CODES_STORAGE_KEY, JSON.stringify(previousCodes));
      localStorage.setItem(EDIT_CODE_RESET_REQUESTS_KEY, JSON.stringify(requests));
      state.auditLog.length = previousAuditLength;
      throw error;
    }
    renderAll();
    showStatusMessage(document.getElementById('user-message'), `Edit code reset for ${account.email}. They must set a new code in My profile.`, false);
  } catch (error) {
    showStatusMessage(document.getElementById('user-message'), error instanceof Error ? error.message : 'Could not reset the edit code.', true);
  }
});

function currentUserEmail() {
  return String(currentAccount?.email || '').trim().toLowerCase();
}

function readNotifications() {
  const saved = JSON.parse(localStorage.getItem(NOTIFICATIONS_STORAGE_KEY) || '[]');
  if (!Array.isArray(saved)) throw new Error('Saved notifications are invalid.');
  return saved;
}

function saveNotifications(notifications) {
  localStorage.setItem(NOTIFICATIONS_STORAGE_KEY, JSON.stringify(notifications));
}

function listNotificationRecipients() {
  const recipients = new Map();
  for (const account of readAccounts()) {
    const email = String(account.email || '').trim().toLowerCase();
    if (email && email !== currentUserEmail()) {
      recipients.set(email, {
        email,
        name: account.name || email,
        department: account.department || ''
      });
    }
  }
  for (const person of state.people) {
    const email = String(person.email || '').trim().toLowerCase();
    if (email && email !== currentUserEmail()) {
      recipients.set(email, {
        email,
        name: person.name || email,
        department: person.department || ''
      });
    }
  }
  return [...recipients.values()].filter((recipient) => (
    isOverseer() || recipient.department.toLowerCase() === String(currentAccount?.department || '').toLowerCase()
  )).sort((left, right) => left.name.localeCompare(right.name));
}

function notificationIsForCurrentUser(notification) {
  const email = currentUserEmail();
  if (notification.type === 'direct') return notification.recipientEmail === email;
  if (notification.type !== 'announcement') return false;
  return notification.audience === 'all'
    || String(notification.department || '').trim().toLowerCase()
      === String(currentAccount?.department || '').trim().toLowerCase();
}

function isNotificationUnread(notification) {
  return !(notification.readBy || []).includes(currentUserEmail());
}

function renderNotifications() {
  const list = document.getElementById('notification-list');
  if (!list) return;
  const recipientSelect = document.getElementById('notification-recipient');
  const recipients = listNotificationRecipients();
  const previousRecipient = recipientSelect.value;
  recipientSelect.innerHTML = '<option value="">Choose a user</option>' + recipients.map((recipient) => `
    <option value="${escapeHtml(recipient.email)}">${escapeHtml(recipient.name)}${recipient.department ? ` · ${escapeHtml(recipient.department)}` : ''} (${escapeHtml(recipient.email)})</option>
  `).join('');
  if (recipients.some((recipient) => recipient.email === previousRecipient)) recipientSelect.value = previousRecipient;

  const departmentSelect = document.getElementById('announcement-department');
  const departmentField = document.getElementById('announcement-department-field');
  populateDepartmentSelect(departmentSelect);
  if (isOverseer()) {
    departmentField.hidden = document.getElementById('announcement-audience').value !== 'department';
  } else {
    departmentField.hidden = true;
  }
  document.getElementById('announcement-audience-field').hidden = !isOverseer();

  try {
    const visible = readNotifications().filter(notificationIsForCurrentUser)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
    const unreadCount = visible.filter(isNotificationUnread).length;
    for (const id of ['notification-count', 'notification-bell-count']) {
      const badge = document.getElementById(id);
      badge.textContent = unreadCount > 99 ? '99+' : String(unreadCount);
      badge.hidden = unreadCount === 0;
    }
    document.getElementById('notification-inbox-summary').textContent = `${unreadCount} unread · ${visible.length} total`;
    list.innerHTML = visible.length ? visible.map((notification) => `
      <article class="notification-card ${notification.type === 'announcement' ? 'announcement' : ''} ${isNotificationUnread(notification) ? 'unread' : ''}">
        <div class="panel-header compact">
          <h4>${escapeHtml(notification.title)}</h4>
          <strong>${notification.type === 'announcement' ? 'URGENT ANNOUNCEMENT' : 'DIRECT NOTIFICATION'}</strong>
        </div>
        <p>${escapeHtml(notification.message)}</p>
        <small>From ${escapeHtml(notification.senderName)} · ${escapeHtml(notification.senderEmail)} · ${escapeHtml(new Date(notification.createdAt).toLocaleString())}${notification.type === 'direct' ? '' : ` · ${escapeHtml(notification.audience === 'all' ? 'Everyone' : notification.department)}`}</small>
        ${isNotificationUnread(notification) ? `<div class="form-actions"><button class="table-action" type="button" data-read-notification="${escapeHtml(notification.id)}">Mark as read</button></div>` : ''}
      </article>
    `).join('') : '<p class="notification-empty">No notifications or announcements yet.</p>';

    const announcement = visible.find((item) => item.type === 'announcement' && isNotificationUnread(item));
    const banner = document.getElementById('announcement-banner');
    banner.hidden = !announcement;
    if (announcement) {
      document.getElementById('announcement-banner-title').textContent = announcement.title;
      document.getElementById('announcement-banner-message').textContent = announcement.message;
      document.getElementById('announcement-banner-meta').textContent = `From ${announcement.senderName} · ${new Date(announcement.createdAt).toLocaleString()}`;
      banner.dataset.announcementId = announcement.id;
    }
  } catch (error) {
    document.getElementById('notification-inbox-summary').textContent = 'Could not load notifications.';
    list.textContent = error instanceof Error ? error.message : 'Could not load notifications.';
    document.getElementById('notification-inbox-summary').classList.add('error-message');
  }
}

function markNotificationRead(notificationId) {
  const notifications = readNotifications();
  const notification = notifications.find((item) => item.id === notificationId);
  if (!notification) return;
  notification.readBy = [...new Set([...(notification.readBy || []), currentUserEmail()])];
  saveNotifications(notifications);
  renderNotifications();
}

function applyAccountAccess() {
  document.querySelectorAll('[data-overseer-only]').forEach((element) => {
    element.hidden = !isOverseer();
  });
  document.querySelectorAll('select[name="department"]').forEach((input) => {
    populateDepartmentSelect(input);
    if (!isOverseer()) {
      input.value = currentAccount?.department || '';
      input.disabled = true;
    } else {
      input.disabled = false;
    }
  });
  renderAdminProfile();
  renderAdminProfileForm();
}

function createWorkflowDialog(id, title, content, wide = false) {
  const dialog = document.createElement('dialog');
  dialog.id = id;
  dialog.className = `workflow-dialog${wide ? ' workflow-dialog-wide' : ''}`;
  dialog.setAttribute('aria-labelledby', `${id}-title`);

  const header = document.createElement('div');
  header.className = 'workflow-dialog-header';
  const heading = document.createElement('h2');
  heading.id = `${id}-title`;
  heading.textContent = title;
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'dialog-close-button';
  closeButton.setAttribute('aria-label', `Close ${title}`);
  closeButton.textContent = '×';
  closeButton.addEventListener('click', () => dialog.close());
  header.append(heading, closeButton);

  const body = document.createElement('div');
  body.className = 'workflow-dialog-body';
  if (content instanceof HTMLElement) body.append(content);
  else body.append(...content);
  dialog.append(header, body);
  dialog.addEventListener('click', (event) => {
    if (event.target === dialog) dialog.close();
  });
  document.body.append(dialog);
  return dialog;
}

function prepareWorkflowDialogs() {
  const formDialogs = [
    ['person-form', 'person-dialog', 'Person profile'],
    ['attendance-form', 'attendance-dialog', 'Record attendance'],
    ['responsibility-form', 'responsibility-dialog', 'Assign responsibility'],
    ['project-form', 'project-dialog', 'Programme / project'],
    ['task-form', 'task-dialog', 'Add task'],
    ['report-form', 'report-dialog', 'Add progress report'],
    ['record-form', 'record-dialog', 'Upload document']
  ];

  for (const [formId, dialogId, title] of formDialogs) {
    const form = document.getElementById(formId);
    const panel = form?.closest('.form-panel');
    if (!panel) continue;
    const parent = panel.parentElement;
    createWorkflowDialog(dialogId, title, panel, ['project-form', 'person-form', 'record-form'].includes(formId));
    if (parent?.classList.contains('management-layout') && !parent.children.length) parent.remove();
  }

  for (const [sectionId, dialogId, title] of [
    ['notifications', 'notifications-dialog', 'Notifications'],
    ['settings', 'settings-dialog', 'Settings'],
    ['profile', 'profile-dialog', 'My profile']
  ]) {
    const section = document.getElementById(sectionId);
    if (!section) continue;
    const content = [...section.childNodes];
    section.hidden = true;
    createWorkflowDialog(dialogId, title, content, true);
  }
}

function openWorkflowDialog(dialogId) {
  const dialog = document.getElementById(dialogId);
  if (!(dialog instanceof HTMLDialogElement)) return;
  if (!dialog.open) dialog.showModal();
}

prepareWorkflowDialogs();

document.getElementById('profile-dialog').addEventListener('close', () => {
  if (pendingEditAction && !editSessionUnlocked && !hasEditCode()) cancelPendingEditAction();
});

document.querySelectorAll('.nav-item[data-tab]').forEach((item) => {
  item.addEventListener('click', () => setActiveTab(item.dataset.tab));
});

document.getElementById('project-department-filter').addEventListener('change', (event) => {
  setSelectedDepartment(event.currentTarget.value);
});

document.getElementById('beneficiary-department-filter').addEventListener('change', (event) => {
  selectedBeneficiaryDepartment = event.currentTarget.value;
  renderDashboardBeneficiaries();
});

document.getElementById('report-month-filter').addEventListener('input', renderReports);

document.querySelectorAll('[data-open-dialog]').forEach((button) => {
  button.addEventListener('click', () => {
    const resetters = {
      'person-dialog': resetPersonForm,
      'attendance-dialog': () => document.getElementById('attendance-form').reset(),
      'responsibility-dialog': () => document.getElementById('responsibility-form').reset(),
      'project-dialog': resetProjectForm,
      'task-dialog': () => document.getElementById('task-form').reset(),
      'report-dialog': resetReportForm,
      'record-dialog': () => {
        const form = document.getElementById('record-form');
        form.reset();
        if (!isOverseer()) form.elements.namedItem('department').value = currentAccount.department;
      }
    };
    resetters[button.dataset.openDialog]?.();
    if (button.dataset.openDialog === 'person-dialog' && button.dataset.profileRole === 'beneficiary') {
      personForm.dataset.profileRole = 'beneficiary';
      roleInput.value = 'beneficiary';
      document.getElementById('person-role-field').hidden = true;
      document.getElementById('person-dialog-title').textContent = 'Add beneficiary';
      personSubmitButton.textContent = 'Save beneficiary';
      syncPersonLoginFields();
    }
    openWorkflowDialog(button.dataset.openDialog);
  });
});

document.getElementById('settings-shortcut').addEventListener('click', () => openWorkflowDialog('settings-dialog'));
document.getElementById('notifications-shortcut').addEventListener('click', () => openWorkflowDialog('notifications-dialog'));
document.getElementById('notification-list').addEventListener('click', (event) => {
  const button = event.target.closest('[data-read-notification]');
  if (button) markNotificationRead(button.dataset.readNotification);
});
document.getElementById('mark-all-notifications-read').addEventListener('click', () => {
  try {
    const notifications = readNotifications();
    for (const notification of notifications) {
      if (notificationIsForCurrentUser(notification)) {
        notification.readBy = [...new Set([...(notification.readBy || []), currentUserEmail()])];
      }
    }
    saveNotifications(notifications);
    renderNotifications();
  } catch (error) {
    showStatusMessage(document.getElementById('notification-message'), error instanceof Error ? error.message : 'Could not update notifications.', true);
  }
});
document.getElementById('dismiss-announcement').addEventListener('click', () => {
  markNotificationRead(document.getElementById('announcement-banner').dataset.announcementId);
});
document.getElementById('announcement-audience').addEventListener('change', renderNotifications);
window.addEventListener('storage', (event) => {
  if (event.key === NOTIFICATIONS_STORAGE_KEY) renderNotifications();
});

document.getElementById('notification-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const recipientEmail = String(form.get('recipient') || '').trim().toLowerCase();
  const recipient = listNotificationRecipients().find((item) => item.email === recipientEmail);
  const status = document.getElementById('notification-message');
  status.hidden = true;
  if (!recipient) {
    showStatusMessage(status, 'Choose a valid user in your available department scope.', true);
    return;
  }
  try {
    const notifications = readNotifications();
    notifications.push({
      id: crypto.randomUUID(),
      type: 'direct',
      title: String(form.get('title') || '').trim(),
      message: String(form.get('message') || '').trim(),
      senderName: currentAccount.name,
      senderEmail: currentUserEmail(),
      recipientEmail,
      createdAt: new Date().toISOString(),
      readBy: []
    });
    saveNotifications(notifications);
    event.currentTarget.reset();
    renderNotifications();
    showStatusMessage(status, `Notification sent to ${recipient.name}.`);
  } catch (error) {
    showStatusMessage(status, error instanceof Error ? error.message : 'Could not send this notification.', true);
  }
});

document.getElementById('announcement-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const audience = isOverseer() ? String(form.get('audience') || 'department') : 'department';
  const department = audience === 'all'
    ? ''
    : isOverseer()
      ? String(form.get('department') || '').trim()
      : String(currentAccount.department || '').trim();
  const status = document.getElementById('announcement-message');
  status.hidden = true;
  if (audience !== 'all' && !department) {
    showStatusMessage(status, 'Choose a department for this announcement.', true);
    return;
  }
  try {
    const notifications = readNotifications();
    notifications.push({
      id: crypto.randomUUID(),
      type: 'announcement',
      title: String(form.get('title') || '').trim(),
      message: String(form.get('message') || '').trim(),
      senderName: currentAccount.name,
      senderEmail: currentUserEmail(),
      audience,
      department,
      createdAt: new Date().toISOString(),
      readBy: []
    });
    saveNotifications(notifications);
    event.currentTarget.reset();
    renderNotifications();
    showStatusMessage(status, 'Urgent announcement posted.');
  } catch (error) {
    showStatusMessage(status, error instanceof Error ? error.message : 'Could not post this announcement.', true);
  }
});

const adminProfileForm = document.getElementById('admin-profile-form');
const adminProfilePhotoInput = adminProfileForm.elements.namedItem('photo');
const adminProfilePhotoPreview = document.querySelector('#admin-photo-preview img');
const adminProfilePhotoPreviewContainer = document.getElementById('admin-photo-preview');
const adminProfileMessage = document.getElementById('admin-profile-message');
let adminProfilePhotoUrl = '';
let removeAdminProfilePhoto = false;
const editCodeForm = document.getElementById('edit-code-form');
const editCodeMessage = document.getElementById('edit-code-message');
const requestEditCodeResetButton = document.getElementById('request-edit-code-reset');

function renderAdminProfileForm() {
  const profile = currentAccount || adminProfile;
  adminProfileForm.elements.namedItem('name').value = profile.name;
  adminProfileForm.elements.namedItem('email').value = profile.email;
  if (profile.photo) {
    adminProfilePhotoPreview.src = profile.photo;
    adminProfilePhotoPreviewContainer.hidden = false;
  } else {
    adminProfilePhotoPreview.removeAttribute('src');
    adminProfilePhotoPreviewContainer.hidden = true;
  }
}

function renderEditCodeSettings() {
  if (!currentAccount) return;
  const identity = editCodeIdentity();
  const codeExists = hasEditCode();
  const requestPending = readEditCodeResetRequests().includes(identity);
  editCodeForm.querySelector('button[type="submit"]').textContent = codeExists ? 'Change edit code' : 'Set edit code';
  requestEditCodeResetButton.hidden = !codeExists || requestPending || editSessionUnlocked;
  if (requestPending) {
    showStatusMessage(editCodeMessage, 'Your reset request is awaiting main overseer approval.');
  } else if (editCodeMessage.textContent.includes('awaiting main overseer approval')) {
    editCodeMessage.hidden = true;
  }
}

editCodeForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    if (hasEditCode() && !editSessionUnlocked) {
      pendingEditAction = { type: 'submit', form: editCodeForm, submitter: event.submitter };
      openEditVerificationDialog();
      return;
    }
    const form = new FormData(editCodeForm);
    const code = String(form.get('code') || '');
    const confirmation = String(form.get('confirmCode') || '');
    const identity = editCodeIdentity();
    const previousAuditLength = state.auditLog.length;
    if (!/^\d{6}$/.test(code)) throw new Error('Edit code must be exactly six digits.');
    if (code !== confirmation) throw new Error('The edit codes do not match.');
    const previousCodes = readEditCodeData();
    const nextCodes = { ...previousCodes, [identity]: await createPasswordAuth(code) };
    localStorage.setItem(EDIT_CODES_STORAGE_KEY, JSON.stringify(nextCodes));
    state.auditLog.push(createAuditEntry(previousCodes[identity] ? 'Changed edit code' : 'Set edit code'));
    try {
      saveState();
    } catch (error) {
      localStorage.setItem(EDIT_CODES_STORAGE_KEY, JSON.stringify(previousCodes));
      state.auditLog.length = previousAuditLength;
      throw error;
    }
    editCodeForm.reset();
    showStatusMessage(editCodeMessage, 'Edit code saved. Enter it to verify changes.');
    renderEditCodeSettings();
    renderAccounts();
    const profileDialog = document.getElementById('profile-dialog');
    if (pendingEditAction && profileDialog.open) profileDialog.close();
    resumePendingEditAction();
  } catch (error) {
    editCodeForm.reset();
    showStatusMessage(editCodeMessage, error instanceof Error ? error.message : 'Could not save your edit code.', true);
  }
});

requestEditCodeResetButton.addEventListener('click', () => {
  const identity = editCodeIdentity();
  const previousRequests = readEditCodeResetRequests();
  if (previousRequests.includes(identity)) return;
  if (!confirm('Confirm that you are the account holder and want the main overseer to reset your edit code.')) return;
  const previousAuditLength = state.auditLog.length;
  try {
    localStorage.setItem(EDIT_CODE_RESET_REQUESTS_KEY, JSON.stringify([...previousRequests, identity]));
    state.auditLog.push(createAuditEntry('Requested an edit-code reset'));
    try {
      saveState();
    } catch (error) {
      localStorage.setItem(EDIT_CODE_RESET_REQUESTS_KEY, JSON.stringify(previousRequests));
      state.auditLog.length = previousAuditLength;
      throw error;
    }
    renderEditCodeSettings();
    renderAccounts();
  } catch (error) {
    showStatusMessage(editCodeMessage, error instanceof Error ? error.message : 'Could not request an edit-code reset.', true);
  }
});

adminProfilePhotoInput.addEventListener('change', () => {
  if (adminProfilePhotoUrl) URL.revokeObjectURL(adminProfilePhotoUrl);
  adminProfilePhotoUrl = '';
  const file = adminProfilePhotoInput.files[0];
  if (!file) return;
  if (!file.type.startsWith('image/')) {
    alert('Choose an image file for your profile picture.');
    adminProfilePhotoInput.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('Choose an image smaller than 10 MB.');
    adminProfilePhotoInput.value = '';
    return;
  }
  adminProfilePhotoUrl = URL.createObjectURL(file);
  adminProfilePhotoPreview.src = adminProfilePhotoUrl;
  adminProfilePhotoPreviewContainer.hidden = false;
  removeAdminProfilePhoto = false;
});

adminProfilePhotoPreview.addEventListener('load', () => {
  if (adminProfilePhotoUrl && adminProfilePhotoPreview.src === adminProfilePhotoUrl) {
    URL.revokeObjectURL(adminProfilePhotoUrl);
    adminProfilePhotoUrl = '';
  }
});

document.getElementById('remove-admin-photo').addEventListener('click', () => {
  removeAdminProfilePhoto = true;
  adminProfilePhotoInput.value = '';
  adminProfilePhotoPreview.removeAttribute('src');
  adminProfilePhotoPreviewContainer.hidden = true;
});

adminProfileForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(adminProfileForm);
  const file = adminProfilePhotoInput.files[0];
  try {
    const updatedProfile = {
      name: String(form.get('name') || '').trim(),
      email: String(form.get('email') || '').trim(),
      photo: file
        ? await resizeProfilePhoto(file)
        : removeAdminProfilePhoto ? '' : (currentAccount?.photo || adminProfile.photo)
    };
    if (!updatedProfile.name || !updatedProfile.email) return;

    if (currentAccount) {
      const previousAccounts = readAccounts();
      const updatedAccount = { ...currentAccount, ...updatedProfile, email: updatedProfile.email.toLowerCase() };
      if (previousAccounts.some((account) => account.id !== updatedAccount.id && account.email.toLowerCase() === updatedAccount.email)) {
        throw new Error('That email address already belongs to an account.');
      }
      const nextAccounts = previousAccounts.map((account) => account.id === currentAccount.id ? updatedAccount : account);
      const previousAccount = currentAccount;
      const previousAuditLength = state.auditLog.length;
      const previousEditCodes = readEditCodeData();
      const previousResetRequests = readEditCodeResetRequests();
      const previousEditIdentity = editCodeIdentity(previousAccount);
      const updatedEditIdentity = editCodeIdentity(updatedAccount);
      const linkedMember = currentAccount.memberId
        ? getPersonById(currentAccount.memberId)
        : null;
      const previousMemberPhoto = linkedMember?.photo;
      try {
        if (previousEditIdentity !== updatedEditIdentity) {
          const nextEditCodes = { ...previousEditCodes };
          if (nextEditCodes[previousEditIdentity]) {
            nextEditCodes[updatedEditIdentity] = nextEditCodes[previousEditIdentity];
            delete nextEditCodes[previousEditIdentity];
          }
          const nextResetRequests = previousResetRequests.map((identity) => (
            identity === previousEditIdentity ? updatedEditIdentity : identity
          ));
          localStorage.setItem(EDIT_CODES_STORAGE_KEY, JSON.stringify(nextEditCodes));
          localStorage.setItem(EDIT_CODE_RESET_REQUESTS_KEY, JSON.stringify([...new Set(nextResetRequests)]));
        }
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(nextAccounts));
        currentAccount = updatedAccount;
        sessionStorage.setItem(AUTH_SESSION_KEY, currentAccount.email);
        saveAuthContext(currentAccount);
        if (linkedMember) linkedMember.photo = updatedProfile.photo;
        state.auditLog.push(createAuditEntry('Updated account profile'));
        saveState();
      } catch (error) {
        localStorage.setItem(EDIT_CODES_STORAGE_KEY, JSON.stringify(previousEditCodes));
        localStorage.setItem(EDIT_CODE_RESET_REQUESTS_KEY, JSON.stringify(previousResetRequests));
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(previousAccounts));
        currentAccount = previousAccount;
        sessionStorage.setItem(AUTH_SESSION_KEY, previousAccount.email);
        saveAuthContext(previousAccount);
        if (linkedMember) linkedMember.photo = previousMemberPhoto;
        state.auditLog.length = previousAuditLength;
        throw new Error('Could not save your profile or its change history. Check available browser storage.');
      }
    } else {
      localStorage.setItem(PROFILE_STORAGE_KEY, JSON.stringify(updatedProfile));
      adminProfile = updatedProfile;
    }

    removeAdminProfilePhoto = false;
    renderAdminProfile();
    renderAdminProfileForm();
    renderEditCodeSettings();
    renderAccounts();
    showStatusMessage(adminProfileMessage, 'Profile saved.');
  } catch (error) {
    showStatusMessage(adminProfileMessage, error instanceof Error ? error.message : 'Could not save profile.', true);
  }
});

renderAdminProfileForm();

const accessibilityForm = document.getElementById('accessibility-form');
const accessibilityMessage = document.getElementById('accessibility-message');

function syncAccessibilityForm() {
  accessibilityForm.elements.namedItem('theme').value = preferences.theme;
  accessibilityForm.elements.namedItem('textSize').value = preferences.textSize;
  accessibilityForm.elements.namedItem('highContrast').checked = preferences.highContrast;
  accessibilityForm.elements.namedItem('reduceMotion').checked = preferences.reduceMotion;
  accessibilityForm.elements.namedItem('largeTargets').checked = preferences.largeTargets;
}

accessibilityForm.addEventListener('change', () => {
  const formData = new FormData(accessibilityForm);
  const updatedPreferences = {
    theme: String(formData.get('theme') || 'dark'),
    textSize: String(formData.get('textSize') || 'normal'),
    highContrast: formData.has('highContrast'),
    reduceMotion: formData.has('reduceMotion'),
    largeTargets: formData.has('largeTargets')
  };
  try {
    localStorage.setItem(PREFERENCES_STORAGE_KEY, JSON.stringify(updatedPreferences));
    preferences = updatedPreferences;
    applyPreferences(preferences);
    accessibilityMessage.textContent = 'Accessibility preferences saved.';
    accessibilityMessage.classList.remove('error-message');
    accessibilityMessage.hidden = false;
  } catch (error) {
    syncAccessibilityForm();
    accessibilityMessage.textContent = 'Could not save your preferences. Check that browser storage is available.';
    accessibilityMessage.classList.add('error-message');
    accessibilityMessage.hidden = false;
  }
});

syncAccessibilityForm();

function showStatusMessage(element, message, isError = false) {
  element.textContent = message;
  element.classList.toggle('error-message', isError);
  element.hidden = false;
}

document.getElementById('change-password-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const formData = new FormData(form);
  const currentPassword = String(formData.get('currentPassword') || '');
  const newPassword = String(formData.get('newPassword') || '');
  const confirmPassword = String(formData.get('confirmPassword') || '');
  const message = document.getElementById('password-change-message');
  message.hidden = true;

  try {
    const salt = Uint8Array.from(currentAccount.salt.match(/.{2}/g), (byte) => Number.parseInt(byte, 16));
    const currentHash = await passwordHash(currentPassword, salt, currentAccount.iterations);
    if (!equalHash(currentHash, currentAccount.hash)) {
      throw new Error('Current password is incorrect.');
    }
    if (newPassword.length < 8) {
      throw new Error('New password must be at least 8 characters.');
    }
    if (newPassword !== confirmPassword) {
      throw new Error('New passwords do not match.');
    }

    const previousAccounts = readAccounts();
    const previousAccount = currentAccount;
    const previousAuditLength = state.auditLog.length;
    const updatedAccount = { ...currentAccount, ...(await createPasswordAuth(newPassword)) };
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(previousAccounts.map((account) => (
      account.id === updatedAccount.id ? updatedAccount : account
    ))));
    currentAccount = updatedAccount;
    state.auditLog.push(createAuditEntry('Changed account password'));
    try {
      saveState();
    } catch (error) {
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(previousAccounts));
      currentAccount = previousAccount;
      state.auditLog.length = previousAuditLength;
      throw new Error('Could not save the new password and its change history. Check available browser storage.');
    }
    form.reset();
    showStatusMessage(message, 'Password updated.');
  } catch (error) {
    showStatusMessage(message, error instanceof Error ? error.message : 'Could not update password.', true);
  }
});

const userForm = document.getElementById('user-form');
userForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!isOverseer()) return;
  const formData = new FormData(userForm);
  const name = String(formData.get('name') || '').trim();
  const email = String(formData.get('email') || '').trim().toLowerCase();
  const department = String(formData.get('department') || '').trim();
  const password = String(formData.get('password') || '');
  const message = document.getElementById('user-message');
  message.hidden = true;

  try {
    if (password.length < 8) throw new Error('Temporary password must be at least 8 characters.');
    const accounts = readAccounts();
    if (accounts.some((account) => account.email.toLowerCase() === email)) {
      throw new Error('An account already uses that email address.');
    }
    const account = {
      id: crypto.randomUUID(),
      name,
      email,
      department,
      role: 'department',
      ...(await createPasswordAuth(password))
    };
    const previousAuditLength = state.auditLog.length;
    localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify([...accounts, account]));
    state.auditLog.push(createAuditEntry(`Created department account for ${email} (${department})`));
    try {
      saveState();
    } catch (error) {
      state.auditLog.length = previousAuditLength;
      localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
      throw new Error('Could not save this account and its change history. Check available browser storage.');
    }
    userForm.reset();
    renderAll();
    showStatusMessage(message, `Account created for ${email}. Share the temporary password with the user securely.`);
  } catch (error) {
    showStatusMessage(message, error instanceof Error ? error.message : 'Could not create the account.', true);
  }
});

document.getElementById('export-data').addEventListener('click', () => {
  if (!isOverseer()) return;
  const backup = {
    format: 'orgflow-backup',
    version: 1,
    exportedAt: new Date().toISOString(),
    data: state
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `orgflow-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  URL.revokeObjectURL(url);
  showStatusMessage(document.getElementById('backup-message'), 'Backup downloaded.');
});

document.getElementById('import-data').addEventListener('change', async (event) => {
  if (!isOverseer()) {
    event.currentTarget.value = '';
    return;
  }
  const input = event.currentTarget;
  const file = input.files[0];
  if (!file) return;
  const message = document.getElementById('backup-message');
  try {
    const backup = JSON.parse(await file.text());
    const data = backup?.format === 'orgflow-backup' ? backup.data : null;
    const collections = ['people', 'attendance', 'responsibilities', 'projects', 'tasks', 'reports', 'records'];
    if (!data || !collections.every((collection) => Array.isArray(data[collection]))) {
      throw new Error('This file is not a valid Positive Young Minds backup.');
    }
    if (!confirm('Restore this backup? Current app data will be replaced.')) return;

    const previousState = Object.fromEntries([
      ...collections.map((collection) => [collection, state[collection]]),
      ['departments', state.departments],
      ['departmentCatalogVersion', state.departmentCatalogVersion]
    ]);
    for (const collection of collections) state[collection] = data[collection];
    state.departments = Array.isArray(data.departments)
      ? data.departments.filter((department) => typeof department === 'string')
      : [...STANDARD_DEPARTMENTS];
    const importedDepartmentCatalogVersion = Number(data.departmentCatalogVersion) || 1;
    if (importedDepartmentCatalogVersion < DEPARTMENT_CATALOG_VERSION
      && !state.departments.some((department) => department.toLowerCase() === 'community outreach')) {
      state.departments.push('Community Outreach');
    }
    state.departmentCatalogVersion = DEPARTMENT_CATALOG_VERSION;
    try {
      saveState();
    } catch (error) {
      for (const [collection, value] of Object.entries(previousState)) state[collection] = value;
      throw new Error('Could not restore the backup to browser storage. The current data has been kept.');
    }
    renderAll();
    showStatusMessage(message, 'Backup restored.');
  } catch (error) {
    showStatusMessage(message, error instanceof Error ? error.message : 'Could not read the backup file.', true);
  } finally {
    input.value = '';
  }
});

document.getElementById('contact-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const to = String(form.get('to') || '').trim();
  const from = String(form.get('from') || '').trim();
  const subject = String(form.get('subject') || '').trim();
  const message = String(form.get('message') || '').trim();
  const body = `${message}${from ? `\n\nReply to: ${from}` : ''}`;
  window.location.href = `mailto:${encodeURIComponent(to)}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
});

const personForm = document.getElementById('person-form');
const photoInput = personForm.elements.namedItem('photo');
const personIdInput = personForm.elements.namedItem('personId');
const roleInput = personForm.elements.namedItem('role');
const customRoleField = document.getElementById('custom-role-field');
const customRoleInput = personForm.elements.namedItem('customRole');
const qualificationInput = personForm.elements.namedItem('qualification');
const customQualificationField = document.getElementById('custom-qualification-field');
const customQualificationInput = personForm.elements.namedItem('customQualification');
const personDocumentInputs = {
  cv: personForm.elements.namedItem('cv'),
  idCopy: personForm.elements.namedItem('idCopy'),
  matricCertificate: personForm.elements.namedItem('matricCertificate')
};
const personDocumentStatuses = {
  cv: document.getElementById('person-cv-status'),
  idCopy: document.getElementById('person-id-copy-status'),
  matricCertificate: document.getElementById('person-matric-status')
};
const MAX_PROFILE_DOCUMENT_BYTES = 2 * 1024 * 1024;
const photoPreview = document.querySelector('#profile-photo-preview img');
const photoPreviewContainer = document.getElementById('profile-photo-preview');
const personSubmitButton = document.getElementById('person-submit-button');
const cancelPersonEditButton = document.getElementById('cancel-person-edit');
const personLoginCheckbox = personForm.elements.namedItem('createAccount');
const personLoginPasswordField = document.getElementById('person-login-password-field');
const personLoginPassword = personForm.elements.namedItem('accountPassword');
const personLoginMessage = document.getElementById('person-login-message');
let photoPreviewUrl = '';

function syncPersonLoginFields(person = null) {
  const account = person && readAccounts().find((item) => Number(item.memberId) === Number(person.id));
  const loginField = document.getElementById('person-login-field');
  const isBeneficiary = roleInput.value === 'beneficiary';
  loginField.hidden = !isOverseer() || Boolean(account) || isBeneficiary;
  personLoginMessage.hidden = !account;
  personLoginMessage.textContent = account ? `This member already has a login account (${account.email}).` : '';
  personLoginPasswordField.hidden = !isOverseer() || Boolean(account) || isBeneficiary || !personLoginCheckbox.checked;
  personLoginPassword.required = personLoginCheckbox.checked && !account && !isBeneficiary;
}

personLoginCheckbox.addEventListener('change', () => {
  const editingPerson = personIdInput.value ? getPersonById(personIdInput.value) : null;
  syncPersonLoginFields(editingPerson);
});

function resetPersonForm() {
  personForm.reset();
  delete personForm.dataset.profileRole;
  document.getElementById('person-role-field').hidden = false;
  personLoginCheckbox.checked = false;
  personIdInput.value = '';
  customRoleField.hidden = true;
  customRoleInput.required = false;
  customRoleInput.value = '';
  customQualificationField.hidden = true;
  customQualificationInput.required = false;
  customQualificationInput.value = '';
  personSubmitButton.textContent = 'Save person';
  cancelPersonEditButton.hidden = true;
  document.getElementById('person-dialog-title').textContent = 'Person profile';
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = '';
  photoPreviewContainer.hidden = true;
  photoPreview.removeAttribute('src');
  for (const [type, input] of Object.entries(personDocumentInputs)) {
    input.value = '';
    personDocumentStatuses[type].textContent = type === 'cv'
      ? 'Optional. Up to 2 MB across all profile documents.'
      : 'Optional.';
  }
  if (!isOverseer()) personForm.elements.namedItem('department').value = currentAccount?.department || '';
  syncPersonLoginFields();
}

function editPerson(personId) {
  const person = getVisiblePersonById(personId);
  if (!person) return;

  delete personForm.dataset.profileRole;
  document.getElementById('person-role-field').hidden = false;
  personLoginCheckbox.checked = false;
  personIdInput.value = person.id;
  personForm.elements.namedItem('name').value = person.name;
  personForm.elements.namedItem('idNumber').value = person.idNumber || '';
  personForm.elements.namedItem('dateOfBirth').value = person.dateOfBirth || '';
  personForm.elements.namedItem('gender').value = person.gender || '';
  personForm.elements.namedItem('email').value = person.email || '';
  personForm.elements.namedItem('phone').value = person.phone || '';
  personForm.elements.namedItem('department').value = person.department || '';
  personForm.elements.namedItem('address').value = person.address || '';
  personForm.elements.namedItem('schoolStatus').value = person.schoolStatus || '';
  personForm.elements.namedItem('motivation').value = person.motivation || '';
  personForm.elements.namedItem('healthCondition').value = person.healthCondition || '';

  const knownRoles = Array.from(roleInput.options).map((option) => option.value);
  if (knownRoles.includes(person.role)) {
    roleInput.value = person.role;
    customRoleInput.value = '';
    customRoleField.hidden = true;
    customRoleInput.required = false;
  } else {
    roleInput.value = 'other';
    customRoleInput.value = person.role;
    customRoleField.hidden = false;
    customRoleInput.required = true;
  }
  syncPersonLoginFields(person);

  const knownQualifications = Array.from(qualificationInput.options).map((option) => option.value);
  if (knownQualifications.includes(person.qualification)) {
    qualificationInput.value = person.qualification || '';
    customQualificationInput.value = '';
    customQualificationField.hidden = true;
    customQualificationInput.required = false;
  } else {
    qualificationInput.value = person.qualification ? 'other' : '';
    customQualificationInput.value = person.qualification || '';
    customQualificationField.hidden = !person.qualification;
    customQualificationInput.required = Boolean(person.qualification);
  }
  for (const [type, input] of Object.entries(personDocumentInputs)) {
    input.value = '';
    const file = person.documents?.[type];
    personDocumentStatuses[type].textContent = file?.name
      ? `Current file: ${file.name}. Choose a new file to replace it.`
      : 'Optional.';
  }

  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = '';
  if (person.photo) {
    photoPreview.src = person.photo;
    photoPreviewContainer.hidden = false;
  } else {
    photoPreview.removeAttribute('src');
    photoPreviewContainer.hidden = true;
  }
  personSubmitButton.textContent = 'Save changes';
  cancelPersonEditButton.hidden = false;
  document.getElementById('person-dialog-title').textContent = 'Edit person profile';
  openWorkflowDialog('person-dialog');
}

roleInput.addEventListener('change', () => {
  const isCustomRole = roleInput.value === 'other';
  customRoleField.hidden = !isCustomRole;
  customRoleInput.required = isCustomRole;
  if (!isCustomRole) customRoleInput.value = '';
  if (roleInput.value === 'beneficiary') personLoginCheckbox.checked = false;
  syncPersonLoginFields(personIdInput.value ? getPersonById(personIdInput.value) : null);
});

qualificationInput.addEventListener('change', () => {
  const isCustomQualification = qualificationInput.value === 'other';
  customQualificationField.hidden = !isCustomQualification;
  customQualificationInput.required = isCustomQualification;
  if (!isCustomQualification) customQualificationInput.value = '';
});

for (const [type, input] of Object.entries(personDocumentInputs)) {
  input.addEventListener('change', () => {
    const file = input.files[0];
    const existingPerson = personIdInput.value ? getPersonById(personIdInput.value) : null;
    personDocumentStatuses[type].textContent = file
      ? `Selected file: ${file.name}.`
      : existingPerson?.documents?.[type]?.name
        ? `Current file: ${existingPerson.documents[type].name}. Choose a new file to replace it.`
        : 'Optional.';
  });
}

function readProfileDocument(file) {
  return new Promise((resolve, reject) => {
    if (file.size > MAX_PROFILE_DOCUMENT_BYTES) {
      reject(new Error(`${file.name} is larger than 2 MB.`));
      return;
    }
    const reader = new FileReader();
    reader.addEventListener('load', () => {
      if (typeof reader.result !== 'string') {
        reject(new Error(`Could not read ${file.name}.`));
        return;
      }
      resolve({ name: file.name, type: file.type, data: reader.result, size: file.size });
    });
    reader.addEventListener('error', () => reject(new Error(`Could not read ${file.name}.`)));
    reader.readAsDataURL(file);
  });
}

photoInput.addEventListener('change', () => {
  if (photoPreviewUrl) URL.revokeObjectURL(photoPreviewUrl);
  photoPreviewUrl = '';
  const file = photoInput.files[0];
  if (!file) {
    photoPreviewContainer.hidden = true;
    photoPreview.removeAttribute('src');
    return;
  }
  if (!file.type.startsWith('image/')) {
    alert('Choose an image file for the profile picture.');
    photoInput.value = '';
    photoPreviewContainer.hidden = true;
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('Choose an image smaller than 10 MB.');
    photoInput.value = '';
    photoPreviewContainer.hidden = true;
    return;
  }
  photoPreviewUrl = URL.createObjectURL(file);
  photoPreview.src = photoPreviewUrl;
  photoPreviewContainer.hidden = false;
});

photoPreview.addEventListener('load', () => {
  if (photoPreviewUrl && photoPreview.src === photoPreviewUrl) {
    URL.revokeObjectURL(photoPreviewUrl);
    photoPreviewUrl = '';
  }
});

personForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(personForm);
  const file = photoInput.files[0];
  try {
    const personId = Number(personIdInput.value);
    const existingPerson = personId ? getPersonById(personId) : null;
    if (!existingPerson && !isOverseer()) {
      throw new Error('Only the main overseer can add profiles.');
    }
    if (existingPerson && !departmentMatches(existingPerson)) {
      throw new Error('You can only edit profiles in your department.');
    }
    const createAccount = isOverseer() && personLoginCheckbox.checked;
    const accountPassword = String(form.get('accountPassword') || '');
    if (createAccount && !String(form.get('email') || '').trim()) {
      throw new Error('Enter the member email address before creating a login.');
    }
    if (createAccount && accountPassword.length < 8) {
      throw new Error('The member temporary password must be at least 8 characters.');
    }
    const accounts = readAccounts();
    const memberEmail = String(form.get('email') || '').trim().toLowerCase();
    if (createAccount && accounts.some((account) => account.email.toLowerCase() === memberEmail)) {
      throw new Error('A login account already uses this email address.');
    }
    if (createAccount && existingPerson && accounts.some((account) => Number(account.memberId) === Number(existingPerson.id))) {
      throw new Error('This member already has a login account.');
    }
    const linkedAccount = existingPerson && accounts.find((account) => Number(account.memberId) === Number(existingPerson.id));
    if (linkedAccount && accounts.some((account) => account.id !== linkedAccount.id && account.email.toLowerCase() === memberEmail)) {
      throw new Error('Another login account already uses this email address.');
    }
    const documents = { ...(existingPerson?.documents || {}) };
    const newDocuments = await Promise.all(Object.entries(personDocumentInputs).map(async ([type, input]) => {
      const selectedFile = input.files[0];
      return selectedFile ? [type, await readProfileDocument(selectedFile)] : null;
    }));
    for (const [type, document] of newDocuments.filter(Boolean)) documents[type] = document;
    if (Object.values(documents).reduce((total, document) => total + Number(document.size || 0), 0) > MAX_PROFILE_DOCUMENT_BYTES) {
      throw new Error('Profile documents must total no more than 2 MB. Remove or replace a document with a smaller file.');
    }
    const person = {
      ...(existingPerson || {}),
      id: existingPerson ? existingPerson.id : uniqueId(state.people),
      name: String(form.get('name') || '').trim(),
      idNumber: String(form.get('idNumber') || '').trim(),
      dateOfBirth: String(form.get('dateOfBirth') || ''),
      gender: String(form.get('gender') || ''),
      role: personForm.dataset.profileRole || (String(form.get('role') || 'staff') === 'other'
        ? String(form.get('customRole') || '').trim()
        : String(form.get('role') || 'staff')),
      email: String(form.get('email') || '').trim(),
      phone: String(form.get('phone') || '').trim(),
      department: isOverseer()
        ? String(form.get('department') || '').trim()
        : currentAccount.department,
      address: String(form.get('address') || '').trim(),
      schoolStatus: String(form.get('schoolStatus') || ''),
      qualification: String(form.get('qualification') || '') === 'other'
        ? String(form.get('customQualification') || '').trim()
        : String(form.get('qualification') || ''),
      motivation: String(form.get('motivation') || '').trim(),
      healthCondition: String(form.get('healthCondition') || '').trim(),
      documents,
      jobTitle: existingPerson?.jobTitle || '',
      startDate: existingPerson?.startDate || '',
      emergencyContact: existingPerson?.emergencyContact || '',
      notes: existingPerson?.notes || '',
      photo: file ? await resizeProfilePhoto(file) : existingPerson?.photo || ''
    };

    if (!person.name || !person.department || (roleInput.value === 'other' && !person.role)
      || (qualificationInput.value === 'other' && !person.qualification)) {
      throw new Error('Complete the required name, department, and any custom role or qualification.');
    }
    const previousPerson = existingPerson ? { ...existingPerson } : null;
    const previousAuditLength = state.auditLog.length;
    const previousCurrentAccount = currentAccount;
    if (existingPerson) {
      Object.assign(existingPerson, person);
    } else {
      state.people.push(person);
    }
    try {
      if (createAccount) {
        const account = {
          id: crypto.randomUUID(),
          memberId: person.id,
          name: person.name,
          email: memberEmail,
          department: person.department,
          role: 'department',
          photo: person.photo,
          ...(await createPasswordAuth(accountPassword))
        };
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify([...accounts, account]));
        state.auditLog.push(createAuditEntry(`Created department login for ${memberEmail} (${person.department})`));
      } else if (linkedAccount) {
        const updatedAccount = {
          ...linkedAccount,
          name: person.name,
          email: memberEmail,
          department: person.department,
          photo: person.photo
        };
        localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts.map((account) => (
          account.id === linkedAccount.id ? updatedAccount : account
        ))));
        if (currentAccount?.id === linkedAccount.id) {
          currentAccount = updatedAccount;
          sessionStorage.setItem(AUTH_SESSION_KEY, updatedAccount.email);
        }
      }
      saveState();
    } catch (error) {
      state.auditLog.length = previousAuditLength;
      if (createAccount || linkedAccount) localStorage.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
      currentAccount = previousCurrentAccount;
      if (currentAccount) sessionStorage.setItem(AUTH_SESSION_KEY, currentAccount.email);
      if (existingPerson && previousPerson) {
        Object.assign(existingPerson, previousPerson);
      } else {
        state.people.pop();
      }
      throw new Error('Could not save this profile or its documents in browser storage. Try smaller files or check available storage.');
    }
    renderAll();
    resetPersonForm();
    document.getElementById('person-dialog').close();
  } catch (error) {
    alert(error.message);
  }
});

function handlePersonTableAction(event) {
  const downloadButton = event.target.closest('[data-download-person-document]');
  if (downloadButton) {
    const person = getVisiblePersonById(downloadButton.dataset.downloadPersonDocument);
    const documentFile = person?.documents?.[downloadButton.dataset.documentType];
    if (!documentFile?.data || !documentFile.name) return;
    const downloadLink = document.createElement('a');
    downloadLink.href = documentFile.data;
    downloadLink.download = documentFile.name;
    downloadLink.click();
    return;
  }
  const button = event.target.closest('[data-edit-person]');
  if (button) editPerson(button.dataset.editPerson);
}

document.getElementById('people-table').addEventListener('click', handlePersonTableAction);
document.getElementById('beneficiaries-table').addEventListener('click', handlePersonTableAction);

cancelPersonEditButton.addEventListener('click', resetPersonForm);

document.getElementById('attendance-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const personId = Number(form.get('personId'));
  const status = String(form.get('status') || 'present');
  const date = String(form.get('date') || localDateString());

  if (!getVisiblePersonById(personId)) {
    alert('Person ID not found in your department.');
    return;
  }
  if (getPersonById(personId).role === 'beneficiary') {
    alert('Attendance can only be recorded for staff and volunteers.');
    return;
  }

  const existing = state.attendance.find((entry) => Number(entry.personId) === personId && entry.attendedOn === date);
  if (existing) {
    existing.status = status;
  } else {
    state.attendance.push({ id: uniqueId(state.attendance), personId, attendedOn: date, status });
  }

  saveState();
  renderAll();
  event.target.reset();
  document.getElementById('attendance-dialog').close();
});

document.getElementById('clock-out-button').addEventListener('click', () => {
  const today = localDateString();
  const entry = currentAttendanceEntry(today);
  const message = document.getElementById('attendance-clock-error');
  message.hidden = true;
  if (!entry?.clockIn || entry.clockOut) {
    message.textContent = 'There is no active clock-in to end today.';
    message.hidden = false;
    return;
  }

  const previousClockOut = entry.clockOut;
  entry.clockOut = new Date().toISOString();
  try {
    saveState();
    renderAll();
  } catch (error) {
    entry.clockOut = previousClockOut;
    message.textContent = error instanceof Error ? error.message : 'Could not save your clock-out.';
    message.hidden = false;
  }
});

document.getElementById('responsibility-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const personId = Number(form.get('personId'));
  const description = String(form.get('description') || '').trim();
  const dueDate = String(form.get('dueDate') || '');

  if (!getVisiblePersonById(personId)) {
    alert('Person ID not found in your department.');
    return;
  }

  state.responsibilities.push({ id: uniqueId(state.responsibilities), personId, description, dueDate });
  saveState();
  renderAll();
  event.target.reset();
  document.getElementById('responsibility-dialog').close();
});

const projectForm = document.getElementById('project-form');
const projectIdInput = projectForm.elements.namedItem('projectId');
const projectFormTitle = document.getElementById('project-form-title');
const projectSubmitButton = document.getElementById('project-submit-button');
const cancelProjectEditButton = document.getElementById('cancel-project-edit');
const activityTypeInput = projectForm.elements.namedItem('activityType');
const customActivityTypeField = document.getElementById('custom-activity-type-field');
const customActivityTypeInput = projectForm.elements.namedItem('customActivityType');
const projectPhotoInput = projectForm.elements.namedItem('photo');
const projectPhotoPreview = document.querySelector('#project-photo-preview img');
const projectPhotoPreviewContainer = document.getElementById('project-photo-preview');
let projectPhotoPreviewUrl = '';

function resetProjectForm() {
  projectForm.reset();
  customActivityTypeField.hidden = true;
  customActivityTypeInput.required = false;
  customActivityTypeInput.value = '';
  if (projectPhotoPreviewUrl) URL.revokeObjectURL(projectPhotoPreviewUrl);
  projectPhotoPreviewUrl = '';
  projectPhotoPreview.removeAttribute('src');
  projectPhotoPreviewContainer.hidden = true;
  projectIdInput.value = '';
  projectForm.elements.namedItem('budget').value = '0';
  projectForm.elements.namedItem('status').value = 'planned';
  projectForm.elements.namedItem('type').value = 'general';
  projectFormTitle.textContent = 'Create Programme or Project';
  document.getElementById('project-dialog-title').textContent = 'Programme / project';
  projectSubmitButton.textContent = 'Create programme / project';
  cancelProjectEditButton.hidden = true;
  if (!isOverseer()) projectForm.elements.namedItem('department').value = currentAccount?.department || '';
}

function editProject(projectId) {
  const project = getVisibleProjectById(projectId);
  if (!project) return;

  projectIdInput.value = project.id;
  projectForm.elements.namedItem('name').value = project.name;
  const activityTypeOptions = Array.from(activityTypeInput.options).map((option) => option.value);
  if (activityTypeOptions.includes(project.activityType)) {
    activityTypeInput.value = project.activityType || 'project';
    customActivityTypeInput.value = '';
    customActivityTypeField.hidden = true;
    customActivityTypeInput.required = false;
  } else if (project.activityType) {
    activityTypeInput.value = 'other';
    customActivityTypeInput.value = project.activityType;
    customActivityTypeField.hidden = false;
    customActivityTypeInput.required = true;
  } else {
    activityTypeInput.value = 'project';
    customActivityTypeInput.value = '';
    customActivityTypeField.hidden = true;
    customActivityTypeInput.required = false;
  }
  projectForm.elements.namedItem('type').value = project.type || 'general';
  projectForm.elements.namedItem('description').value = project.description || '';
  projectForm.elements.namedItem('department').value = project.department || '';
  projectForm.elements.namedItem('lead').value = project.lead || '';
  projectForm.elements.namedItem('status').value = project.status || 'planned';
  projectForm.elements.namedItem('address').value = project.address || '';
  projectForm.elements.namedItem('budget').value = project.budget ?? 0;
  projectForm.elements.namedItem('startDate').value = project.startDate || '';
  projectForm.elements.namedItem('deadline').value = project.deadline || '';
  projectForm.elements.namedItem('notes').value = project.notes || '';
  if (project.photo) {
    projectPhotoPreview.src = project.photo;
    projectPhotoPreviewContainer.hidden = false;
  } else {
    projectPhotoPreview.removeAttribute('src');
    projectPhotoPreviewContainer.hidden = true;
  }
  projectFormTitle.textContent = `Edit Programme / Project #${project.id}`;
  projectSubmitButton.textContent = 'Save changes';
  cancelProjectEditButton.hidden = false;
  document.getElementById('project-dialog-title').textContent = 'Edit programme / project';
  openWorkflowDialog('project-dialog');
  projectForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
}

activityTypeInput.addEventListener('change', () => {
  const isCustomActivityType = activityTypeInput.value === 'other';
  customActivityTypeField.hidden = !isCustomActivityType;
  customActivityTypeInput.required = isCustomActivityType;
  if (!isCustomActivityType) customActivityTypeInput.value = '';
});

projectPhotoInput.addEventListener('change', () => {
  if (projectPhotoPreviewUrl) URL.revokeObjectURL(projectPhotoPreviewUrl);
  projectPhotoPreviewUrl = '';
  const file = projectPhotoInput.files[0];
  if (!file) {
    const project = getProjectById(projectIdInput.value);
    if (project?.photo) {
      projectPhotoPreview.src = project.photo;
      projectPhotoPreviewContainer.hidden = false;
    } else {
      projectPhotoPreview.removeAttribute('src');
      projectPhotoPreviewContainer.hidden = true;
    }
    return;
  }
  if (!file.type.startsWith('image/')) {
    alert('Choose an image file for the project picture.');
    projectPhotoInput.value = '';
    return;
  }
  if (file.size > 10 * 1024 * 1024) {
    alert('Choose an image smaller than 10 MB.');
    projectPhotoInput.value = '';
    return;
  }
  projectPhotoPreviewUrl = URL.createObjectURL(file);
  projectPhotoPreview.src = projectPhotoPreviewUrl;
  projectPhotoPreviewContainer.hidden = false;
});

projectPhotoPreview.addEventListener('load', () => {
  if (projectPhotoPreviewUrl && projectPhotoPreview.src === projectPhotoPreviewUrl) {
    URL.revokeObjectURL(projectPhotoPreviewUrl);
    projectPhotoPreviewUrl = '';
  }
});

projectForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const form = new FormData(projectForm);
  const projectId = Number(projectIdInput.value);
  const existingProject = projectId ? getVisibleProjectById(projectId) : null;
  if (projectId && !existingProject) {
    alert('Project not found in your department.');
    return;
  }
  try {
    const department = isOverseer()
      ? String(form.get('department') || '').trim()
      : String(currentAccount?.department || '').trim();
    if (!department) {
      alert('Choose a department for this programme or project.');
      return;
    }
    const file = projectPhotoInput.files[0];
    const project = {
      ...(existingProject || {}),
      id: existingProject ? existingProject.id : uniqueId(state.projects),
      name: String(form.get('name') || '').trim(),
      activityType: String(form.get('activityType') || '') === 'other'
        ? String(form.get('customActivityType') || '').trim()
        : String(form.get('activityType') || ''),
      type: String(form.get('type') || 'general'),
      description: String(form.get('description') || '').trim(),
      department,
      lead: String(form.get('lead') || '').trim(),
      status: String(form.get('status') || 'planned'),
      address: String(form.get('address') || '').trim(),
      budget: Number(form.get('budget')) || 0,
      startDate: String(form.get('startDate') || ''),
      deadline: String(form.get('deadline') || ''),
      notes: String(form.get('notes') || '').trim(),
      photo: file ? await resizeProfilePhoto(file) : existingProject?.photo || ''
    };

    if (!project.name || !project.activityType) {
      alert('Enter a programme/project name and choose an activity type.');
      return;
    }
    const previousProject = existingProject ? { ...existingProject } : null;
    if (existingProject) {
      Object.assign(existingProject, project);
    } else {
      state.projects.push(project);
    }
    try {
      saveState();
    } catch (error) {
      if (existingProject && previousProject) {
        Object.assign(existingProject, previousProject);
      } else {
        state.projects.pop();
      }
      throw new Error('Could not save this project in browser storage. Try an image with a smaller file size.');
    }
    renderAll();
    resetProjectForm();
    document.getElementById('project-dialog').close();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('project-table').addEventListener('click', (event) => {
  const button = event.target.closest('[data-edit-project]');
  if (button) editProject(button.dataset.editProject);
});

cancelProjectEditButton.addEventListener('click', resetProjectForm);

document.getElementById('task-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(event.target);
  const projectId = Number(form.get('projectId'));

  if (!getVisibleProjectById(projectId)) {
    alert('Programme or project not found in your department.');
    return;
  }

  state.tasks.push({
    id: uniqueId(state.tasks),
    projectId,
    title: String(form.get('title') || '').trim(),
    dueDate: String(form.get('dueDate') || ''),
    status: 'pending'
  });
  saveState();
  renderAll();
  event.target.reset();
  document.getElementById('task-dialog').close();
});

const reportForm = document.getElementById('report-form');

function resetReportForm() {
  reportForm.reset();
  reportForm.elements.namedItem('reportingMonth').value = localDateString().slice(0, 7);
}

document.getElementById('report-form').addEventListener('submit', (event) => {
  event.preventDefault();
  const form = new FormData(reportForm);
  const projectId = Number(form.get('projectId'));
  const reportingMonth = String(form.get('reportingMonth') || '');
  const report = String(form.get('report') || '').trim();

  if (!getVisibleProjectById(projectId)) {
    alert('Programme or project not found in your department.');
    return;
  }
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(reportingMonth)) {
    alert('Choose a valid reporting month.');
    return;
  }

  state.reports.push({
    id: uniqueId(state.reports),
    projectId,
    reportingMonth,
    report,
    createdAt: new Date().toISOString().slice(0, 10)
  });
  document.getElementById('report-month-filter').value = reportingMonth;
  saveState();
  renderAll();
  resetReportForm();
  document.getElementById('report-dialog').close();
});

document.getElementById('record-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  const recordForm = event.target;
  const form = new FormData(recordForm);
  const file = form.get('file');
  if (!(file instanceof File) || !file.name) {
    alert('Choose a document to upload.');
    return;
  }
  if (file.size > 2 * 1024 * 1024) {
    alert('This browser-based app supports documents up to 2 MB. Choose a smaller file.');
    return;
  }

  try {
    const fileData = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('Could not read the selected document.'));
      reader.readAsDataURL(file);
    });

    const record = {
      id: uniqueId(state.records),
      title: String(form.get('title') || '').trim(),
      category: String(form.get('category') || '').trim(),
      department: isOverseer()
        ? String(form.get('department') || '').trim()
        : currentAccount.department,
      description: String(form.get('description') || '').trim(),
      uploadedBy: {
        accountId: currentAccount.id,
        name: currentAccount.name,
        email: currentAccount.email
      },
      originalName: file.name,
      createdAt: new Date().toISOString().slice(0, 10),
      fileData
    };

    state.records.push(record);
    try {
      saveState();
    } catch (error) {
      state.records.pop();
      throw new Error('Could not save this document in browser storage. Try a smaller file or remove unused browser data.');
    }
    renderAll();
    recordForm.reset();
    if (!isOverseer()) recordForm.elements.namedItem('department').value = currentAccount.department;
    document.getElementById('record-dialog').close();
  } catch (error) {
    alert(error.message);
  }
});

document.getElementById('record-search').addEventListener('input', renderRecords);

setActiveTab('dashboard');
applyAccountAccess();
startAutomaticClockIn();
renderAll();
