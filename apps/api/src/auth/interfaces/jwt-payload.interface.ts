export interface JwtPayload {
  sub: string;
  tenantId: string;
  email: string;
  role: string;
}

export interface AuthenticatedUser {
  userId: string;
  tenantId: string;
  email: string;
  role: string;
}

