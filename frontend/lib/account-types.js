export const ACCOUNT_TYPE_OPTIONS = [
  { id: 'student', label: 'Sinh viên' },
  { id: 'intern', label: 'Thực tập sinh' },
  { id: 'trainee_lawyer', label: 'Luật sư tập sự' },
  { id: 'licensed_lawyer', label: 'Luật sư chính thức' },
  { id: 'partner', label: 'Partner' },
  { id: 'professional', label: 'Tài khoản chuyên nghiệp' },
];

export const ACCOUNT_CONFIG = {
  student: {
    label: 'Sinh viên',
    requires: ['schoolName', 'majorName'],
    status: 'active',
    entitlements: { maxVideoCount: 5, canSelectFrame: false },
  },
  intern: {
    label: 'Thực tập sinh',
    requires: ['schoolName', 'majorName'],
    status: 'active',
    entitlements: { maxVideoCount: 5, canSelectFrame: false },
  },
  trainee_lawyer: {
    label: 'Luật sư tập sự',
    requires: ['schoolName', 'lawFirmName'],
    status: 'active',
    entitlements: { maxVideoCount: 5, canSelectFrame: false },
  },
  licensed_lawyer: {
    label: 'Luật sư chính thức',
    requires: ['lawyerCardImage'],
    status: 'pending_admin_review',
    entitlements: { maxVideoCount: 5, canSelectFrame: false },
  },
  partner: {
    label: 'Partner',
    requires: ['companyName', 'jobTitle'],
    status: 'active',
    entitlements: { maxVideoCount: 5, canSelectFrame: false },
  },
  professional: {
    label: 'Tài khoản chuyên nghiệp',
    requires: [],
    status: 'pending_admin_review',
    entitlements: { maxVideoCount: 10, canSelectFrame: true },
  },
};

export const FRAME_OPTIONS = [
  { id: '16:9', label: '16:9 ngang' },
  { id: '9:16', label: '9:16 dọc' },
  { id: '1:1', label: '1:1 vuông' },
  { id: '4:5', label: '4:5 social' },
  { id: '21:9', label: '21:9 cinematic' },
];

export function getAccountConfig(accountType) {
  return ACCOUNT_CONFIG[accountType] || ACCOUNT_CONFIG.student;
}
