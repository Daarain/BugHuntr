/**
 * Central Repositories Index (MongoDB)
 *
 * Exposes repository abstractions for all non-identity application entities.
 */

import type { Db } from "mongodb";
import { getMongoDatabase } from "../mongodb";
import { WalletsRepository } from "./wallets.repo";
import { PayoutsRepository } from "./payouts.repo";
import { SubmissionsRepository } from "./submissions.repo";
import { HuntsRepository } from "./hunts.repo";
import { OrganizationsRepository } from "./organizations.repo";
import { VulnerabilitiesRepository } from "./vulnerabilities.repo";
import { GamificationRepository } from "./gamification.repo";
import { CommunitiesRepository } from "./communities.repo";
import { ProRepository } from "./pro.repo";
import { PreferencesRepository } from "./preferences.repo";
import { ensureMongoIndexes } from "./indexes";

export { WalletsRepository } from "./wallets.repo";
export { PayoutsRepository } from "./payouts.repo";
export { SubmissionsRepository } from "./submissions.repo";
export { HuntsRepository } from "./hunts.repo";
export { OrganizationsRepository } from "./organizations.repo";
export { VulnerabilitiesRepository } from "./vulnerabilities.repo";
export { GamificationRepository } from "./gamification.repo";
export { CommunitiesRepository } from "./communities.repo";
export { ProRepository } from "./pro.repo";
export { PreferencesRepository } from "./preferences.repo";
export { ensureMongoIndexes } from "./indexes";

export interface Repositories {
  wallets: WalletsRepository;
  payouts: PayoutsRepository;
  submissions: SubmissionsRepository;
  hunts: HuntsRepository;
  organizations: OrganizationsRepository;
  vulnerabilities: VulnerabilitiesRepository;
  gamification: GamificationRepository;
  communities: CommunitiesRepository;
  pro: ProRepository;
  preferences: PreferencesRepository;
}

/**
 * Returns instantiated repositories for the MongoDB database.
 * If db is not provided, lazily acquires default database via getMongoDatabase().
 */
export async function getRepositories(dbInstance?: Db): Promise<Repositories> {
  const db = dbInstance || (await getMongoDatabase());

  return {
    wallets: new WalletsRepository(db),
    payouts: new PayoutsRepository(db),
    submissions: new SubmissionsRepository(db),
    hunts: new HuntsRepository(db),
    organizations: new OrganizationsRepository(db),
    vulnerabilities: new VulnerabilitiesRepository(db),
    gamification: new GamificationRepository(db),
    communities: new CommunitiesRepository(db),
    pro: new ProRepository(db),
    preferences: new PreferencesRepository(db),
  };
}
