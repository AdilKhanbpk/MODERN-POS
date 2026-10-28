import bcrypt from 'bcryptjs';
import { UserRepository } from '../../infrastructure/sqlite/repositories/UserRepository';
import { User } from '../../shared/types';
import { Role } from '../../shared/constants/roles-permissions';

export class AuthService {
  private currentUser: User | null = null;

  constructor(private userRepo: UserRepository = new UserRepository()) {}

  public login(username: string, passwordPlain: string): User {
    const user = this.userRepo.findByUsername(username);
    if (!user) {
      throw new Error('Invalid username or password');
    }

    const isMatch = bcrypt.compareSync(passwordPlain, user.passwordHash);
    if (!isMatch) {
      throw new Error('Invalid username or password');
    }

    const safeUser: User = {
      id: user.id,
      username: user.username,
      fullName: user.fullName,
      role: user.role,
      isActive: user.isActive,
      createdAt: user.createdAt
    };

    this.currentUser = safeUser;
    return safeUser;
  }

  public getCurrentUser(): User | null {
    return this.currentUser;
  }

  public logout(): void {
    this.currentUser = null;
  }

  public listUsers(): User[] {
    return this.userRepo.list();
  }

  public createUser(userData: {
    username: string;
    passwordPlain: string;
    fullName: string;
    role: Role;
  }): number {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(userData.passwordPlain, salt);

    return this.userRepo.create({
      username: userData.username,
      passwordHash,
      fullName: userData.fullName,
      role: userData.role
    });
  }

  public updatePassword(userId: number, newPasswordPlain: string): void {
    const salt = bcrypt.genSaltSync(10);
    const passwordHash = bcrypt.hashSync(newPasswordPlain, salt);
    this.userRepo.updatePassword(userId, passwordHash);
  }
}

