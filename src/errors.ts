export class BoltstoreError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "BoltstoreError";
    this.status = status;
    this.code = code;
    this.details = details;
    Object.setPrototypeOf(this, BoltstoreError.prototype);
  }
}