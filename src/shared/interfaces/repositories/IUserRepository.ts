import { User } from '../../types';
import { Role } from '../../constants/roles-permissions';

export interface IUserRepository {
  findById(id: number): User | null;
  findByUsername(username: string): (User & { passwordHash: string }) | null;
  list(): User[];
  create(user: {
    username: string;
    passwordHash: string;
    fullName: string;
    role: Role | string;
    isActive?: boolean;
  }): number;
  updatePassword(id: number, passwordHash: string): void;
  updateStatus(id: number, isActive: boolean): void;
}

