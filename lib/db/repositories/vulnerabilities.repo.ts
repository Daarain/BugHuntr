/**
 * Vulnerabilities & CVE Requests Repository (MongoDB)
 *
 * Implements triaged vulnerabilities, CVSS 3.1 vector calculation records,
 * scoring factor audits, and coordinated vulnerability disclosure (CVE) packets.
 */

import type { Collection, Db, ClientSession } from "mongodb";
import type { VulnerabilityDoc, VulnerabilityAuditDoc, CveRequestDoc } from "../types";

export class VulnerabilitiesRepository {
  private vulnsCol: Collection<VulnerabilityDoc>;
  private auditCol: Collection<VulnerabilityAuditDoc>;
  private cveCol: Collection<CveRequestDoc>;

  constructor(db: Db) {
    this.vulnsCol = db.collection<VulnerabilityDoc>("vulnerabilities");
    this.auditCol = db.collection<VulnerabilityAuditDoc>("vulnerabilities_audit");
    this.cveCol = db.collection<CveRequestDoc>("cve_requests");
  }

  /**
   * Creates a triaged vulnerability finding.
   * Unique constraint on submission_id ensures only one vulnerability record per bug report.
   */
  async createVulnerability(vuln: VulnerabilityDoc, session?: ClientSession): Promise<VulnerabilityDoc> {
    const doc: VulnerabilityDoc = {
      ...vuln,
      created_at: vuln.created_at || new Date(),
      updated_at: vuln.updated_at || new Date(),
    };

    await this.vulnsCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves a vulnerability by its associated submissionId.
   */
  async getBySubmissionId(submissionId: string, session?: ClientSession): Promise<VulnerabilityDoc | null> {
    return this.vulnsCol.findOne({ submission_id: submissionId }, { session });
  }

  /**
   * Retrieves a vulnerability by ID (e.g., BH-VULN-...).
   */
  async getById(id: string, session?: ClientSession): Promise<VulnerabilityDoc | null> {
    return this.vulnsCol.findOne({ _id: id }, { session });
  }

  /**
   * Updates CVSS vector, score, and triage approval state.
   */
  async updateCvssScore(
    vulnId: string,
    cvss: VulnerabilityDoc["cvss"],
    bughuntrScore?: VulnerabilityDoc["bughuntr_score"],
    triagedBy?: string,
    notes?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const update: any = {
      $set: {
        cvss,
        status: "approved",
        updated_at: new Date(),
      },
    };
    if (bughuntrScore) update.$set.bughuntr_score = bughuntrScore;
    if (triagedBy) update.$set.triaged_by = triagedBy;
    if (notes) update.$set.triage_notes = notes;

    const res = await this.vulnsCol.updateOne({ _id: vulnId }, update, { session });
    return res.matchedCount > 0;
  }

  /**
   * Records an immutable triage vector audit trail entry.
   */
  async logAudit(audit: VulnerabilityAuditDoc, session?: ClientSession): Promise<VulnerabilityAuditDoc> {
    const doc: VulnerabilityAuditDoc = {
      ...audit,
      _id: audit._id || `audit_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`,
      created_at: audit.created_at || new Date(),
    };

    await this.auditCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves all audit trail logs for a vulnerability.
   */
  async listAuditLogs(vulnId: string): Promise<VulnerabilityAuditDoc[]> {
    return this.auditCol.find({ vuln_id: vulnId }).sort({ created_at: -1 }).toArray();
  }

  /**
   * Creates a coordinated vulnerability disclosure (CVE) request.
   */
  async createCveRequest(req: CveRequestDoc, session?: ClientSession): Promise<CveRequestDoc> {
    const doc: CveRequestDoc = {
      ...req,
      created_at: req.created_at || new Date(),
      updated_at: req.updated_at || new Date(),
    };

    await this.cveCol.insertOne(doc, { session });
    return doc;
  }

  /**
   * Retrieves a CVE request for a vulnerability.
   */
  async getCveRequestByVuln(vulnId: string): Promise<CveRequestDoc | null> {
    return this.cveCol.findOne({ vuln_id: vulnId });
  }

  /**
   * Updates CVE request status and records assigned CVE ID.
   */
  async updateCveStatus(
    id: string,
    status: CveRequestDoc["status"],
    actorUid: string,
    cveId?: string,
    notes?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const now = new Date();
    const update: any = {
      $set: {
        status,
        updated_at: now,
      },
      $push: {
        status_history: {
          status,
          changedAt: now,
          changedBy: actorUid,
          notes,
        },
      },
    };
    if (cveId) update.$set.cve_id = cveId;

    const res = await this.cveCol.updateOne({ _id: id }, update, { session });
    return res.matchedCount > 0;
  }

  /**
   * Lists vulnerabilities with filtering and pagination.
   */
  async listVulnerabilities(
    filters?: {
      orgId?: string;
      status?: string;
      severity?: string;
      reporterUid?: string;
      limit?: number;
    },
    session?: ClientSession
  ): Promise<VulnerabilityDoc[]> {
    const query: any = {};
    if (filters?.orgId) query.org_id = filters.orgId;
    if (filters?.status) query.status = filters.status;
    if (filters?.reporterUid) query.reporter_uid = filters.reporterUid;
    if (filters?.severity) {
      query.$or = [
        { "cvss.severity": filters.severity },
        { "cvss.severity": filters.severity.toUpperCase() },
        { "cvss.severity": filters.severity.toLowerCase() },
      ];
    }
    const limit = filters?.limit || 50;
    return this.vulnsCol
      .find(query, { session })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Counts vulnerabilities matching filter criteria.
   */
  async countVulnerabilities(
    filters?: {
      orgId?: string;
      status?: string;
      reporterUid?: string;
    },
    session?: ClientSession
  ): Promise<number> {
    const query: any = {};
    if (filters?.orgId) query.org_id = filters.orgId;
    if (filters?.status) query.status = filters.status;
    if (filters?.reporterUid) query.reporter_uid = filters.reporterUid;
    return this.vulnsCol.countDocuments(query, { session });
  }

  /**
   * Updates vulnerability status and records triage notes.
   */
  async updateStatus(
    vulnId: string,
    status: VulnerabilityDoc["status"],
    notes?: string,
    actorUid?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const update: any = {
      $set: {
        status,
        updated_at: new Date(),
      },
    };
    if (notes !== undefined) update.$set.triage_notes = notes;
    if (actorUid !== undefined) {
      update.$set.triaged_by = actorUid;
      update.$set.triaged_at = new Date();
    }
    const res = await this.vulnsCol.updateOne({ _id: vulnId }, update, { session });
    return res.matchedCount > 0;
  }

  /**
   * Generic partial update for vulnerability document fields.
   */
  async updateVulnerability(
    vulnId: string,
    fields: Partial<VulnerabilityDoc>,
    session?: ClientSession
  ): Promise<boolean> {
    const { _id, ...safeFields } = fields as any;
    const update: any = {
      $set: {
        ...safeFields,
        updated_at: new Date(),
      },
    };
    const res = await this.vulnsCol.updateOne({ _id: vulnId }, update, { session });
    return res.matchedCount > 0;
  }

  /**
   * Retrieves a CVE request by ID.
   */
  async getCveRequestById(id: string, session?: ClientSession): Promise<CveRequestDoc | null> {
    return this.cveCol.findOne({ _id: id }, { session });
  }

  /**
   * Lists CVE requests with optional filtering.
   */
  async listCveRequests(
    filters?: {
      orgId?: string;
      status?: string;
      requestedBy?: string;
      vulnId?: string;
      limit?: number;
    },
    session?: ClientSession
  ): Promise<CveRequestDoc[]> {
    const query: any = {};
    if (filters?.orgId) query.org_id = filters.orgId;
    if (filters?.status) query.status = filters.status;
    if (filters?.requestedBy) query.requested_by = filters.requestedBy;
    if (filters?.vulnId) query.vuln_id = filters.vulnId;
    const limit = filters?.limit || 50;
    return this.cveCol
      .find(query, { session })
      .sort({ created_at: -1 })
      .limit(limit)
      .toArray();
  }

  /**
   * Updates CVE request details and status history.
   */
  async updateCveRequest(
    id: string,
    fields: Partial<CveRequestDoc>,
    actorUid: string,
    notes?: string,
    session?: ClientSession
  ): Promise<boolean> {
    const now = new Date();
    const { _id, ...safeFields } = fields as any;
    const update: any = {
      $set: {
        ...safeFields,
        updated_at: now,
      },
    };

    if (fields.status) {
      update.$push = {
        status_history: {
          status: fields.status,
          changedAt: now,
          changedBy: actorUid,
          notes,
        },
      };
    }

    const res = await this.cveCol.updateOne({ _id: id }, update, { session });
    return res.matchedCount > 0;
  }
}
