import type { Role } from "@/generated/prisma/enums";
import { sid, type SeedContext } from "./context";

export interface SeedUser {
  key: string;
  email: string;
  name: string;
  roles: Role[];
}

const NAMED: SeedUser[] = [
  { key: "faculty", email: "faculty@socra.local", name: "Dana Whitfield", roles: ["INSTRUCTOR"] },
  {
    key: "faculty2",
    email: "faculty2@socra.local",
    name: "Marcus Oyelaran",
    roles: ["INSTRUCTOR"],
  },
  { key: "ta", email: "ta@socra.local", name: "Priya Raman", roles: ["TA"] },
  {
    key: "research",
    email: "research@socra.local",
    name: "Elena Sorensen",
    roles: ["RESEARCH_ADMIN"],
  },
  { key: "admin", email: "admin@socra.local", name: "Sam Kowalski", roles: ["SYSTEM_ADMIN"] },
];

const FIRST = [
  "Avery",
  "Jordan",
  "Riley",
  "Morgan",
  "Casey",
  "Taylor",
  "Jamie",
  "Quinn",
  "Rowan",
  "Skyler",
  "Hayden",
  "Emerson",
  "Finley",
  "Reese",
  "Sawyer",
  "Parker",
  "Kendall",
  "Logan",
  "Drew",
  "Blake",
  "Cameron",
  "Elliot",
  "Harper",
  "Jesse",
  "Kai",
  "Lane",
  "Micah",
  "Noel",
  "Peyton",
  "Sage",
];
const LAST = [
  "Nguyen",
  "Patel",
  "Garcia",
  "Kim",
  "Okafor",
  "Silva",
  "Chen",
  "Haddad",
  "Novak",
  "Ibrahim",
  "Murphy",
  "Rossi",
  "Tanaka",
  "Mensah",
  "Kowalczyk",
  "Alvarez",
  "Singh",
  "Larsen",
  "Baptiste",
  "Cohen",
  "Moreau",
  "Yilmaz",
  "Ahmed",
  "Fischer",
  "Ortiz",
  "Lindqvist",
  "Dubois",
  "Kaur",
  "Petrov",
  "Walsh",
];

export const STUDENT_COUNT = 30;

export function studentUsers(): SeedUser[] {
  return Array.from({ length: STUDENT_COUNT }, (_, i) => ({
    key: `student${i + 1}`,
    email: `student${i + 1}@socra.local`,
    name: `${FIRST[i]} ${LAST[i]}`,
    roles: ["STUDENT"] as Role[],
  }));
}

export function allSeedUsers(): SeedUser[] {
  return [...studentUsers(), ...NAMED];
}

export async function seedUsers(ctx: SeedContext): Promise<void> {
  for (const u of allSeedUsers()) {
    const id = sid("user", u.key);
    await ctx.prisma.user.upsert({
      where: { email: u.email },
      create: { id, email: u.email, name: u.name, roles: u.roles, isActive: true },
      update: { name: u.name, roles: u.roles, isActive: true, deactivatedAt: null },
    });
    const user = await ctx.prisma.user.findUniqueOrThrow({
      where: { email: u.email },
      select: { id: true },
    });
    ctx.ids.users[u.key] = user.id;
    await ctx.prisma.authIdentity.upsert({
      where: { provider_issuer_subject: { provider: "LOCAL", issuer: "local", subject: u.email } },
      create: {
        userId: user.id,
        provider: "LOCAL",
        issuer: "local",
        subject: u.email,
        passwordHash: ctx.passwordHash,
      },
      update: { userId: user.id, passwordHash: ctx.passwordHash },
    });
  }
  ctx.log(`users: ${allSeedUsers().length} (${STUDENT_COUNT} students)`);
}
