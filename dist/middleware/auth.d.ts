import { Request, Response, NextFunction } from 'express';
export interface AuthRequest extends Request {
    user?: {
        id: string;
        email: string;
        role: string;
        companyId?: string;
    };
}
export declare function authenticate(req: AuthRequest, _res: Response, next: NextFunction): void;
export declare function requireAdmin(req: AuthRequest, _res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map