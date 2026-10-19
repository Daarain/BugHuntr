# BugHuntr Pro - Role-Based Views Documentation

## Overview

BugHuntr Pro now supports **dual role-based views** with a sophisticated permission system that distinguishes between:

1. **System Role**: `admin` vs `user` (administrative privileges)
2. **Business Role**: `company` vs `hunter` (functional role in the platform)

This creates **four possible role combinations**, each with distinct features and permissions.

---

## Role Combinations

### 1. Admin + Company

**Full platform privileges with company features**

**Permissions:**

- ✅ Create Pro hunts
- ✅ Manage all Pro hunts
- ✅ Review all applications
- ✅ Send invitations to hunters
- ✅ Manage subscriptions
- ✅ View AI-powered hunter recommendations
- ✅ Browse all Pro hunts
- ✅ Access admin-only features

**Use Cases:**

- Company administrators managing bug bounty programs
- Security team leaders organizing Pro hunts
- Platform admins with company accounts

---

### 2. User + Company

**Standard company account with limited privileges**

**Permissions:**

- ✅ Create Pro hunts
- ✅ Manage own Pro hunts
- ✅ Review applications for own hunts
- ✅ Send invitations to hunters
- ✅ Manage own subscription
- ✅ View AI-powered hunter recommendations
- ✅ Browse all Pro hunts
- ❌ No admin-only features

**Use Cases:**

- Regular company employees managing hunts
- Startup founders running their own security programs
- Small business security managers

---

### 3. Admin + Hunter

**Administrative privileges with hunter capabilities**

**Permissions:**

- ✅ Browse all Pro hunts
- ✅ Apply to Pro hunts
- ✅ View own applications
- ✅ Check hunt eligibility
- ✅ Sign NDAs
- ✅ Submit vulnerability reports
- ✅ Access admin-only features
- ❌ Cannot create hunts
- ❌ Cannot review applications

**Use Cases:**

- Platform administrators who also hunt
- Community managers testing hunter experience
- Support staff with elevated privileges

---

### 4. User + Hunter

**Standard hunter account**

**Permissions:**

- ✅ Browse all Pro hunts
- ✅ Apply to Pro hunts (if eligible)
- ✅ View own applications
- ✅ Check hunt eligibility
- ✅ Sign NDAs
- ✅ Submit vulnerability reports
- ❌ Cannot create hunts
- ❌ Cannot review applications
- ❌ No admin features

**Use Cases:**

- Security researchers
- Bug bounty hunters
- Ethical hackers
- Penetration testers

---

## User Interface Differences

### Pro Dashboard (`/pro`)

#### Company View (Admin/User + Company)

**Quick Actions:**

- 🎯 Create Pro Hunt
- 📋 Review Applications
- 💼 Manage My Hunts
- 🎯 Find Elite Hunters (with AI recommendations)

#### Hunter View (Admin/User + Hunter)

**Quick Actions:**

- 🔍 Browse Pro Hunts
- 📝 My Applications

---

### Pro Hunts Page (`/pro/hunts`)

#### Company View

**Features:**

- **Tab Navigation**: "Browse All Hunts" | "My Hunts"
- **Manage Mode**: View and manage own Pro hunts
- **Browse Mode**: See all available Pro hunts on platform
- **Create Hunt Button**: Quick access to hunt creation
- **AI Recommendations**: Get hunter suggestions for hunts
- **Hunt Card Actions**: "Manage Hunt" | "Get Recommendations"

#### Hunter View

**Features:**

- **Browse Only**: Single view of all available hunts
- **Eligibility Card**: Shows current rank, experience, certifications
- **Hunt Card Actions**: "View Details" | "Apply Now" (if eligible)
- **Eligibility Warnings**: Clear indicators of missing requirements
- **NDA Modal**: Sign NDAs when applying

---

### Applications Page (`/pro/applications`)

#### Company View

**Features:**

- **Title**: "Review Applications"
- **Description**: "Manage hunter applications for your Pro hunts"
- **Applications Shown**: All applications for company's hunts
- **Actions Per Application**:
  - ✅ Approve
  - 📧 Request More Info
  - ❌ Reject
  - 📤 Send Invitation (after approval)

#### Hunter View

**Features:**

- **Title**: "My Pro Applications"
- **Description**: "Track your Pro hunt applications and invitations"
- **Applications Shown**: Only hunter's own applications
- **Actions Per Application**:
  - ✅ Sign NDA & Begin (if approved)
  - 📧 Provide Additional Info (if requested)
  - 👁️ View Hunt Details

---

### Create Hunt Page (`/pro/hunts/create`)

#### Access Control

- **Allowed**: Admin + Company, User + Company
- **Denied**: Admin + Hunter, User + Hunter

#### Hunter Access Attempt

Shows access denied message:

- ⚠️ "Access Denied"
- "Only companies can create Pro hunts"
- Buttons: "Go to Pro Dashboard" | "Browse Hunts"

---

## Technical Implementation

### User Type Storage

```typescript
interface User {
  id: string;
  username: string;
  email?: string;
  role: "user" | "admin"; // System role
  userType: "company" | "hunter"; // Business role

  // Company-specific fields
  companyName?: string;
  companyId?: string;
  companyDomain?: string;
  representativeName?: string;

  // Hunter-specific fields
  rank?: "C" | "B" | "A" | "S";
  huntsParticipated?: number;
  certifications?: string[];
  reputation?: number;

  twoFactorEnabled?: boolean;
}
```

### Permission Utility

```typescript
export function getUserPermissions(
  role: "user" | "admin",
  userType: "company" | "hunter"
): UserPermissions {
  return {
    // Company permissions
    canCreateHunts: userType === "company",
    canManageHunts: userType === "company",
    canReviewApplications: userType === "company",
    canSendInvitations: userType === "company",
    canManageSubscriptions: userType === "company",
    canViewRecommendations: userType === "company",

    // Hunter permissions
    canApplyToHunts: userType === "hunter",
    canViewOwnApplications: userType === "hunter",

    // Shared permissions
    canBrowseHunts: true, // Everyone can browse

    // Role flags
    isCompany: userType === "company",
    isHunter: userType === "hunter",
    isAdmin: role === "admin",
  };
}
```

### Usage in Components

```typescript
const { user } = useAuth();
const permissions = user ? getUserPermissions(user.role, user.userType) : null;

// Conditional rendering
{
  permissions?.canCreateHunts && (
    <Button onClick={createHunt}>Create Hunt</Button>
  );
}

// Navigation guards
useEffect(() => {
  if (user && !permissions?.canCreateHunts) {
    router.push("/pro");
  }
}, [user, permissions]);
```

---

## Development & Testing

### Role Switcher (Dev Only)

A development utility is available in the Pro dashboard to quickly switch between role combinations:

**Location**: Bottom-right corner of Pro dashboard
**Button**: "Dev: Switch Role"

**Options:**

- 🏢 Admin + Company
- 🏢 User + Company
- 👤 Admin + Hunter
- 👤 User + Hunter

**Note**: Only visible in development mode (`NODE_ENV !== "production"`)

### Mock Data

Default mock data for testing:

**Company:**

```typescript
{
  companyId: "company_test_123",
  companyName: "Test Corporation",
  companyDomain: "testcorp.com",
  representativeName: "John Doe",
}
```

**Hunter:**

```typescript
{
  rank: "B",
  huntsParticipated: 35,
  certifications: ["OSCP", "CEH", "CISSP"],
  reputation: 4.7,
}
```

---

## Firestore Integration

### User Document Structure

```typescript
// users/{userId}
{
  email: string,
  username: string,
  password: string, // hashed
  userType: "company" | "hunter", // Business role
  role: "user" | "admin",         // System role (optional, defaults to "user")

  // Company fields (if userType === "company")
  companyName?: string,
  companyId?: string,
  companyDomain?: string,
  representativeName?: string,

  // Hunter fields (if userType === "hunter")
  rank?: "C" | "B" | "A" | "S",
  huntsParticipated?: number,
  certifications?: string[],
  reputation?: number,

  // Common fields
  createdAt: Timestamp,
  updatedAt: Timestamp,
  twoFactorEnabled?: boolean,
}
```

### Login Flow

1. User provides credentials
2. Firestore query retrieves user document
3. Password validation (bcrypt)
4. Extract `role` and `userType` from document
5. Call `login(email, email, role, userType, userData)`
6. Auth context stores complete user object
7. Redirect to appropriate dashboard

---

## UI/UX Guidelines

### Visual Indicators

**Role Badges:**

- 🟣 `Admin` - Purple badge
- 🔵 `User` - Blue badge

**User Type Badges:**

- 🟡 `Company` - Amber badge
- 🟢 `Hunter` - Green badge

### Navigation Flow

**Company Landing:**

1. Pro Dashboard → Shows company quick actions
2. Click "Create Pro Hunt" → Hunt creation wizard
3. Click "Manage My Hunts" → Hunts page (manage tab)
4. Click "Review Applications" → Applications page (company view)

**Hunter Landing:**

1. Pro Dashboard → Shows hunter quick actions
2. Click "Browse Pro Hunts" → Hunts page (browse view)
3. Click "My Applications" → Applications page (hunter view)
4. See hunt → Check eligibility → Apply

### Error Handling

**Access Denied Scenarios:**

- Hunter tries to access `/pro/hunts/create`
  - Shows: Access denied card with navigation options
- Unauthenticated user accesses Pro pages

  - Redirects to login page

- User without Pro subscription (company)
  - Shows upgrade prompt

---

## Testing Checklist

### Company Tests

- [ ] Admin + Company can create hunts
- [ ] Admin + Company can view recommendations
- [ ] Admin + Company can review applications
- [ ] User + Company has same features as admin (minus admin-only)
- [ ] Company can switch between manage/browse tabs
- [ ] Company can approve/reject applications

### Hunter Tests

- [ ] Hunter can browse all Pro hunts
- [ ] Hunter can see eligibility requirements
- [ ] Hunter can apply to eligible hunts
- [ ] Hunter can view own applications only
- [ ] Hunter cannot access create hunt page
- [ ] Hunter sees correct quick actions

### Cross-Role Tests

- [ ] Role badges display correctly
- [ ] Permissions enforced consistently
- [ ] Navigation guards work properly
- [ ] Role switcher (dev) changes views correctly
- [ ] Login flow sets correct roles

---

## Future Enhancements

### Planned Features

1. **Dynamic Role Assignment**: Allow users to have multiple roles
2. **Role-Based Notifications**: Different notification types per role
3. **Permission Templates**: Pre-configured permission sets
4. **Audit Logging**: Track role-based actions
5. **Company Teams**: Multiple users per company with different permissions

### Firebase Custom Claims

When moving to production Firebase Auth:

```typescript
// Set custom claims after authentication
await admin.auth().setCustomUserClaims(userId, {
  role: "admin",
  userType: "company",
  companyId: "company_123",
});

// Verify in security rules
match /pro_hunts/{huntId} {
  allow create: if request.auth.token.userType == "company";
  allow read: if request.auth != null;
}
```

---

## Troubleshooting

### User sees wrong view

**Solution**: Clear localStorage and re-login

```javascript
localStorage.removeItem("isAuthenticated");
localStorage.removeItem("currentUser");
```

### Permissions not updating

**Solution**: Refresh page after role change (dev mode auto-reloads)

### Role switcher not showing

**Check**: Ensure `NODE_ENV` is not set to "production"

### Cannot access certain features

**Verify**: Check user role and userType in auth context

```typescript
console.log({ role: user?.role, userType: user?.userType });
```

---

## Contact & Support

For issues related to role-based views:

1. Check this documentation
2. Review `/lib/pro-utils.ts` for permission logic
3. Inspect auth context state
4. Use role switcher (dev mode) for testing

---

**Version**: 2.0.0  
**Last Updated**: January 2025  
**Status**: Implemented & Ready for Testing
