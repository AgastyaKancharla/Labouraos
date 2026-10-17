import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, LoginResponseDto } from './dto/login.dto';
import { JwtPayload } from './jwt-payload.interface';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async hashPassword(password: string): Promise<string> {
    const saltRounds = 10;
    return bcrypt.hash(password, saltRounds);
  }

  async verifyPassword(password: string, hash: string): Promise<boolean> {
    return bcrypt.compare(password, hash);
  }

  async login(loginDto: LoginDto): Promise<LoginResponseDto> {
    const staff = await this.prisma.staff.findUnique({
      where: { email: loginDto.email },
    });

    if (!staff) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const isMatch = await this.verifyPassword(loginDto.password, staff.passwordHash);
    if (!isMatch) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = {
      sub: staff.id,
      role: staff.role,
      email: staff.email,
      code: staff.code,
      area: staff.area,
      teamLeadId: staff.teamLeadId,
    };

    const accessToken = await this.jwtService.signAsync(payload);

    return {
      accessToken,
      staff: {
        id: staff.id,
        code: staff.code,
        name: staff.name,
        email: staff.email,
        role: staff.role,
        area: staff.area,
      },
    };
  }

  async verifyToken(token: string): Promise<JwtPayload> {
    try {
      return await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
