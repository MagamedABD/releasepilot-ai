/**
 * Типы схемы базы данных.
 *
 * Источник истины — файлы в supabase/migrations. Этот файл описывает их
 * на стороне TypeScript и сверяется со схемой живой базы скриптом
 * scripts/check-db-types.ts (он ходит в OpenAPI-описание, которое Supabase
 * отдаёт по /rest/v1/, и сравнивает состав таблиц и колонок).
 *
 * Правило: сначала миграция, потом этот файл, потом прогон сверки.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type AppRole = 'owner' | 'admin' | 'manager' | 'lead' | 'viewer';
export type TeamKind = 'frontend' | 'backend' | 'qa' | 'analytics' | 'design' | 'other';
export type TaskStatus = 'backlog' | 'in_progress' | 'review' | 'testing' | 'done' | 'cancelled';
export type TaskPriority = 'P0' | 'P1' | 'P2' | 'P3';
export type ReleaseStatus = 'planned' | 'active' | 'released' | 'postponed' | 'cancelled';
export type DependencyType = 'blocks' | 'relates';
export type RiskLevelDb = 'low' | 'medium' | 'high' | 'critical';

export type Database = {
  public: {
    Tables: {
      organizations: {
        Row: { id: string; name: string; slug: string; created_at: string; updated_at: string };
        Insert: { id?: string; name: string; slug: string; created_at?: string; updated_at?: string };
        Update: { id?: string; name?: string; slug?: string; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      profiles: {
        Row: { id: string; full_name: string | null; avatar_url: string | null; created_at: string; updated_at: string };
        Insert: { id: string; full_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Update: { id?: string; full_name?: string | null; avatar_url?: string | null; created_at?: string; updated_at?: string };
        Relationships: [];
      };
      memberships: {
        Row: { id: string; org_id: string; user_id: string; role: AppRole; created_at: string };
        Insert: { id?: string; org_id: string; user_id: string; role?: AppRole; created_at?: string };
        Update: { id?: string; org_id?: string; user_id?: string; role?: AppRole; created_at?: string };
        Relationships: [
          { foreignKeyName: 'memberships_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'memberships_user_id_fkey', columns: ['user_id'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
      teams: {
        Row: { id: string; org_id: string; name: string; kind: TeamKind; created_at: string; updated_at: string };
        Insert: { id?: string; org_id: string; name: string; kind?: TeamKind; created_at?: string; updated_at?: string };
        Update: { id?: string; org_id?: string; name?: string; kind?: TeamKind; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: 'teams_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
        ];
      };
      team_members: {
        Row: { id: string; org_id: string; team_id: string; profile_id: string; allocation_pct: number; created_at: string };
        Insert: { id?: string; org_id: string; team_id: string; profile_id: string; allocation_pct?: number; created_at?: string };
        Update: { id?: string; org_id?: string; team_id?: string; profile_id?: string; allocation_pct?: number; created_at?: string };
        Relationships: [
          { foreignKeyName: 'team_members_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'team_members_team_id_fkey', columns: ['team_id'], isOneToOne: false, referencedRelation: 'teams', referencedColumns: ['id'] },
          { foreignKeyName: 'team_members_profile_id_fkey', columns: ['profile_id'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
      team_capacity: {
        Row: {
          id: string; org_id: string; team_id: string; period_start: string; period_end: string;
          available_hours: number; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; team_id: string; period_start: string; period_end: string;
          available_hours: number; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; team_id?: string; period_start?: string; period_end?: string;
          available_hours?: number; created_at?: string; updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'team_capacity_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'team_capacity_team_id_fkey', columns: ['team_id'], isOneToOne: false, referencedRelation: 'teams', referencedColumns: ['id'] },
        ];
      };
      absences: {
        Row: {
          id: string; org_id: string; profile_id: string; start_date: string; end_date: string;
          reason: string | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; profile_id: string; start_date: string; end_date: string;
          reason?: string | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; profile_id?: string; start_date?: string; end_date?: string;
          reason?: string | null; created_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'absences_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'absences_profile_id_fkey', columns: ['profile_id'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
      projects: {
        Row: { id: string; org_id: string; name: string; key: string; created_at: string; updated_at: string };
        Insert: { id?: string; org_id: string; name: string; key: string; created_at?: string; updated_at?: string };
        Update: { id?: string; org_id?: string; name?: string; key?: string; created_at?: string; updated_at?: string };
        Relationships: [
          { foreignKeyName: 'projects_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
        ];
      };
      releases: {
        Row: {
          id: string; org_id: string; project_id: string; name: string; status: ReleaseStatus;
          planned_date: string; started_at: string | null; released_at: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; project_id: string; name: string; status?: ReleaseStatus;
          planned_date: string; started_at?: string | null; released_at?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; project_id?: string; name?: string; status?: ReleaseStatus;
          planned_date?: string; started_at?: string | null; released_at?: string | null;
          created_at?: string; updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'releases_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'releases_project_id_fkey', columns: ['project_id'], isOneToOne: false, referencedRelation: 'projects', referencedColumns: ['id'] },
        ];
      };
      tasks: {
        Row: {
          id: string; org_id: string; project_id: string; release_id: string | null;
          external_key: string | null; title: string; description: string | null;
          status: TaskStatus; priority: TaskPriority; estimate_h: number; spent_h: number;
          team_id: string | null; assignee_id: string | null;
          added_to_release_at: string | null; blocked_since: string | null;
          created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; project_id: string; release_id?: string | null;
          external_key?: string | null; title: string; description?: string | null;
          status?: TaskStatus; priority?: TaskPriority; estimate_h: number; spent_h?: number;
          team_id?: string | null; assignee_id?: string | null;
          added_to_release_at?: string | null; blocked_since?: string | null;
          created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; project_id?: string; release_id?: string | null;
          external_key?: string | null; title?: string; description?: string | null;
          status?: TaskStatus; priority?: TaskPriority; estimate_h?: number; spent_h?: number;
          team_id?: string | null; assignee_id?: string | null;
          added_to_release_at?: string | null; blocked_since?: string | null;
          created_at?: string; updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'tasks_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_project_id_fkey', columns: ['project_id'], isOneToOne: false, referencedRelation: 'projects', referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_release_id_fkey', columns: ['release_id'], isOneToOne: false, referencedRelation: 'releases', referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_team_id_fkey', columns: ['team_id'], isOneToOne: false, referencedRelation: 'teams', referencedColumns: ['id'] },
          { foreignKeyName: 'tasks_assignee_id_fkey', columns: ['assignee_id'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
      task_dependencies: {
        Row: {
          id: string; org_id: string; blocker_task_id: string; blocked_task_id: string;
          type: DependencyType; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; blocker_task_id: string; blocked_task_id: string;
          type?: DependencyType; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; blocker_task_id?: string; blocked_task_id?: string;
          type?: DependencyType; created_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'task_dependencies_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'task_dependencies_blocker_task_id_fkey', columns: ['blocker_task_id'], isOneToOne: false, referencedRelation: 'tasks', referencedColumns: ['id'] },
          { foreignKeyName: 'task_dependencies_blocked_task_id_fkey', columns: ['blocked_task_id'], isOneToOne: false, referencedRelation: 'tasks', referencedColumns: ['id'] },
        ];
      };
      release_snapshots: {
        Row: {
          id: string; org_id: string; release_id: string; captured_at: string;
          readiness_pct: number; risk_score: number; risk_level: RiskLevelDb;
          probability_on_time: number | null; metrics: Json; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; release_id: string; captured_at?: string;
          readiness_pct: number; risk_score: number; risk_level: RiskLevelDb;
          probability_on_time?: number | null; metrics: Json; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; release_id?: string; captured_at?: string;
          readiness_pct?: number; risk_score?: number; risk_level?: RiskLevelDb;
          probability_on_time?: number | null; metrics?: Json; created_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'release_snapshots_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'release_snapshots_release_id_fkey', columns: ['release_id'], isOneToOne: false, referencedRelation: 'releases', referencedColumns: ['id'] },
        ];
      };
      scenarios: {
        Row: {
          id: string; org_id: string; release_id: string; created_by: string | null;
          title: string; payload: Json; result: Json | null;
          applied_at: string | null; applied_by: string | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; release_id: string; created_by?: string | null;
          title: string; payload: Json; result?: Json | null;
          applied_at?: string | null; applied_by?: string | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; release_id?: string; created_by?: string | null;
          title?: string; payload?: Json; result?: Json | null;
          applied_at?: string | null; applied_by?: string | null; created_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'scenarios_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'scenarios_release_id_fkey', columns: ['release_id'], isOneToOne: false, referencedRelation: 'releases', referencedColumns: ['id'] },
          { foreignKeyName: 'scenarios_created_by_fkey', columns: ['created_by'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
          { foreignKeyName: 'scenarios_applied_by_fkey', columns: ['applied_by'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
      agent_sessions: {
        Row: {
          id: string; org_id: string; user_id: string; release_id: string | null;
          title: string | null; created_at: string; updated_at: string;
        };
        Insert: {
          id?: string; org_id: string; user_id: string; release_id?: string | null;
          title?: string | null; created_at?: string; updated_at?: string;
        };
        Update: {
          id?: string; org_id?: string; user_id?: string; release_id?: string | null;
          title?: string | null; created_at?: string; updated_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'agent_sessions_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'agent_sessions_user_id_fkey', columns: ['user_id'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
          { foreignKeyName: 'agent_sessions_release_id_fkey', columns: ['release_id'], isOneToOne: false, referencedRelation: 'releases', referencedColumns: ['id'] },
        ];
      };
      agent_messages: {
        Row: {
          id: string; org_id: string; session_id: string; role: string;
          content: string | null; tool_calls: Json | null;
          input_tokens: number | null; output_tokens: number | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; session_id: string; role: string;
          content?: string | null; tool_calls?: Json | null;
          input_tokens?: number | null; output_tokens?: number | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; session_id?: string; role?: string;
          content?: string | null; tool_calls?: Json | null;
          input_tokens?: number | null; output_tokens?: number | null; created_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'agent_messages_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'agent_messages_session_id_fkey', columns: ['session_id'], isOneToOne: false, referencedRelation: 'agent_sessions', referencedColumns: ['id'] },
        ];
      };
      import_runs: {
        Row: {
          id: string; org_id: string; started_by: string | null; source: string; status: string;
          stats: Json | null; error_report: Json | null;
          started_at: string; finished_at: string | null;
        };
        Insert: {
          id?: string; org_id: string; started_by?: string | null; source: string; status?: string;
          stats?: Json | null; error_report?: Json | null;
          started_at?: string; finished_at?: string | null;
        };
        Update: {
          id?: string; org_id?: string; started_by?: string | null; source?: string; status?: string;
          stats?: Json | null; error_report?: Json | null;
          started_at?: string; finished_at?: string | null;
        };
        Relationships: [
          { foreignKeyName: 'import_runs_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'import_runs_started_by_fkey', columns: ['started_by'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
      audit_log: {
        Row: {
          id: string; org_id: string; actor_id: string | null; entity: string;
          entity_id: string | null; action: string;
          before: Json | null; after: Json | null; created_at: string;
        };
        Insert: {
          id?: string; org_id: string; actor_id?: string | null; entity: string;
          entity_id?: string | null; action: string;
          before?: Json | null; after?: Json | null; created_at?: string;
        };
        Update: {
          id?: string; org_id?: string; actor_id?: string | null; entity?: string;
          entity_id?: string | null; action?: string;
          before?: Json | null; after?: Json | null; created_at?: string;
        };
        Relationships: [
          { foreignKeyName: 'audit_log_org_id_fkey', columns: ['org_id'], isOneToOne: false, referencedRelation: 'organizations', referencedColumns: ['id'] },
          { foreignKeyName: 'audit_log_actor_id_fkey', columns: ['actor_id'], isOneToOne: false, referencedRelation: 'profiles', referencedColumns: ['id'] },
        ];
      };
    };
    Views: Record<string, never>;
    Functions: {
      create_organization: {
        Args: { p_name: string; p_slug: string };
        Returns: Database['public']['Tables']['organizations']['Row'];
        Relationships: [];
      };
      owned_org_count: {
        Args: { p_user: string };
        Returns: number;
        Relationships: [];
      };
    };
    Enums: {
      app_role: AppRole;
      team_kind: TeamKind;
      task_status: TaskStatus;
      task_priority: TaskPriority;
      release_status: ReleaseStatus;
      dependency_type: DependencyType;
      risk_level: RiskLevelDb;
    };
  };
};

/** Сокращения для прикладного кода: Row<'tasks'> вместо длинной цепочки. */
export type Tables = Database['public']['Tables'];
export type Row<T extends keyof Tables> = Tables[T]['Row'];
export type Insert<T extends keyof Tables> = Tables[T]['Insert'];
export type Update<T extends keyof Tables> = Tables[T]['Update'];
