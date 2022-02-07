export interface EdgeCertRenewalResponse {
  id: string;
  uploads: EdgeCertRenewalResponseUploads[];
}

export interface EdgeCertRenewalResponseUploads {
  name: 'certificate' | 'certificate_key';
  url: string;
}

export interface EdgeCertDetails {
  subject: string;
  signing_type: 'not-self-signed' | string;
  signed_by: string;
  expiry: string;
}

export interface CertRenewalConfig {
  domains: string[];
  dns: string;
  server: string;
  debug: boolean;
  dnssleep: number;
  env: string;
  files: {
    cert: CertRenewalFile;
    certFullchain: CertRenewalFile;
    key: CertRenewalFile;
    [key: string]: CertRenewalFile;
  };
  edge_ip?: string;
  skip_cert_replacement: boolean;
  insecure?: boolean;
  renewDays: number;
  mail?: string;
  challengeAlias?: string;
}

export interface CertRenewalFile {
  path: string;
  uploadName: string;
}
