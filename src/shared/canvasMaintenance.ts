export interface CanvasMaintenanceFile {
  path: string;
  byteSize?: number;
  modifiedAt?: string;
  status: 'protected' | 'review' | 'candidate';
  reasons: string[];
}
export interface CanvasMaintenanceScan {
  token: string;
  expiresAt: string;
  minimumAgeHours: number;
  referencesComplete: boolean;
  warnings: string[];
  files: CanvasMaintenanceFile[];
}
export interface CanvasQuarantineBatch {
  id: string;
  createdAt: string;
  reviewReason?: string;
  files: Array<{ path: string; byteSize: number; status: 'pending' | 'quarantined' | 'restored' }>;
}
