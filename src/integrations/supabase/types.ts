export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      activity_log: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: string | null
          entity_id: string | null
          entity_type: string
          execution_id: string | null
          id: string
          result: string
          worker_id: string | null
          workflow_id: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string
          execution_id?: string | null
          id?: string
          result?: string
          worker_id?: string | null
          workflow_id?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entity_id?: string | null
          entity_type?: string
          execution_id?: string | null
          id?: string
          result?: string
          worker_id?: string | null
          workflow_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "activity_log_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "activity_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      ai_workers: {
        Row: {
          avatar_url: string | null
          color: string
          concurrency_limit: number
          created_at: string
          created_by: string | null
          description: string | null
          execution_mode: string
          execution_timeout_seconds: number
          icon: string
          id: string
          language: string
          memory_enabled: boolean
          memory_priority: number
          memory_retention_days: number
          memory_size: number
          memory_type: Database["public"]["Enums"]["memory_layer"]
          model: string | null
          name: string
          priority: number
          provider: string
          purpose: string
          region: string
          retry_count: number
          status: Database["public"]["Enums"]["worker_status"]
          tags: string[]
          timezone: string
          type: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          avatar_url?: string | null
          color?: string
          concurrency_limit?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_mode?: string
          execution_timeout_seconds?: number
          icon?: string
          id?: string
          language?: string
          memory_enabled?: boolean
          memory_priority?: number
          memory_retention_days?: number
          memory_size?: number
          memory_type?: Database["public"]["Enums"]["memory_layer"]
          model?: string | null
          name: string
          priority?: number
          provider?: string
          purpose?: string
          region?: string
          retry_count?: number
          status?: Database["public"]["Enums"]["worker_status"]
          tags?: string[]
          timezone?: string
          type?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          avatar_url?: string | null
          color?: string
          concurrency_limit?: number
          created_at?: string
          created_by?: string | null
          description?: string | null
          execution_mode?: string
          execution_timeout_seconds?: number
          icon?: string
          id?: string
          language?: string
          memory_enabled?: boolean
          memory_priority?: number
          memory_retention_days?: number
          memory_size?: number
          memory_type?: Database["public"]["Enums"]["memory_layer"]
          model?: string | null
          name?: string
          priority?: number
          provider?: string
          purpose?: string
          region?: string
          retry_count?: number
          status?: Database["public"]["Enums"]["worker_status"]
          tags?: string[]
          timezone?: string
          type?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      api_keys: {
        Row: {
          created_at: string
          created_by: string | null
          environment: string
          expires_at: string | null
          id: string
          key_hash: string
          last_used_at: string | null
          name: string
          prefix: string
          revoked_at: string | null
          rotated_at: string | null
          scopes: string[]
          updated_at: string
          usage_count: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at?: string | null
          id?: string
          key_hash: string
          last_used_at?: string | null
          name: string
          prefix: string
          revoked_at?: string | null
          rotated_at?: string | null
          scopes?: string[]
          updated_at?: string
          usage_count?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: string
          expires_at?: string | null
          id?: string
          key_hash?: string
          last_used_at?: string | null
          name?: string
          prefix?: string
          revoked_at?: string | null
          rotated_at?: string | null
          scopes?: string[]
          updated_at?: string
          usage_count?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "api_keys_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          amount: number | null
          created_at: string
          currency: string
          decided_by: string | null
          decision_note: string | null
          details: string | null
          id: string
          levels_approved: number
          levels_required: number
          requested_by: string | null
          status: Database["public"]["Enums"]["approval_state"]
          subject_id: string | null
          subject_type: string
          title: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          created_at?: string
          currency?: string
          decided_by?: string | null
          decision_note?: string | null
          details?: string | null
          id?: string
          levels_approved?: number
          levels_required?: number
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_state"]
          subject_id?: string | null
          subject_type: string
          title: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number | null
          created_at?: string
          currency?: string
          decided_by?: string | null
          decision_note?: string | null
          details?: string | null
          id?: string
          levels_approved?: number
          levels_required?: number
          requested_by?: string | null
          status?: Database["public"]["Enums"]["approval_state"]
          subject_id?: string | null
          subject_type?: string
          title?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      billing_subscriptions: {
        Row: {
          amount: number
          billing_cycle: string
          cancel_at_period_end: boolean
          cancelled_at: string | null
          created_at: string
          created_by: string | null
          currency: string
          current_period_end: string
          current_period_start: string
          id: string
          metadata: Json
          payment_provider: Database["public"]["Enums"]["payment_provider"]
          plan: string
          scope: Database["public"]["Enums"]["billing_scope"]
          seats: number
          status: Database["public"]["Enums"]["subscription_status"]
          tax_rate: number
          trial_ends_at: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          amount?: number
          billing_cycle?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          metadata?: Json
          payment_provider?: Database["public"]["Enums"]["payment_provider"]
          plan?: string
          scope?: Database["public"]["Enums"]["billing_scope"]
          seats?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          tax_rate?: number
          trial_ends_at?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          amount?: number
          billing_cycle?: string
          cancel_at_period_end?: boolean
          cancelled_at?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          current_period_end?: string
          current_period_start?: string
          id?: string
          metadata?: Json
          payment_provider?: Database["public"]["Enums"]["payment_provider"]
          plan?: string
          scope?: Database["public"]["Enums"]["billing_scope"]
          seats?: number
          status?: Database["public"]["Enums"]["subscription_status"]
          tax_rate?: number
          trial_ends_at?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "billing_subscriptions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      brand_profiles: {
        Row: {
          brand_name: string | null
          colors: Json
          created_at: string
          fonts: Json
          guidelines: string | null
          id: string
          keywords: string[]
          logo_url: string | null
          tone: string | null
          updated_at: string
          voice: string | null
          workspace_id: string
          writing_style: string | null
        }
        Insert: {
          brand_name?: string | null
          colors?: Json
          created_at?: string
          fonts?: Json
          guidelines?: string | null
          id?: string
          keywords?: string[]
          logo_url?: string | null
          tone?: string | null
          updated_at?: string
          voice?: string | null
          workspace_id: string
          writing_style?: string | null
        }
        Update: {
          brand_name?: string | null
          colors?: Json
          created_at?: string
          fonts?: Json
          guidelines?: string | null
          id?: string
          keywords?: string[]
          logo_url?: string | null
          tone?: string | null
          updated_at?: string
          voice?: string | null
          workspace_id?: string
          writing_style?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "brand_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      campaign_budget_allocations: {
        Row: {
          allocated: number
          campaign_id: string
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at: string
          id: string
          spent: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          allocated?: number
          campaign_id: string
          channel: Database["public"]["Enums"]["marketing_channel"]
          created_at?: string
          id?: string
          spent?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          allocated?: number
          campaign_id?: string
          channel?: Database["public"]["Enums"]["marketing_channel"]
          created_at?: string
          id?: string
          spent?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_budget_allocations_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_budget_allocations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      creative_requests: {
        Row: {
          assigned_worker_id: string | null
          brief: string | null
          campaign_id: string | null
          created_at: string
          created_by: string | null
          credit_cost: number
          credit_type: Database["public"]["Enums"]["credit_type"]
          duration_ms: number | null
          execution_id: string | null
          id: string
          kind: Database["public"]["Enums"]["creative_kind"]
          output: Json
          parent_request_id: string | null
          performance_score: number | null
          saved_to_library: boolean
          status: Database["public"]["Enums"]["creative_status"]
          title: string
          updated_at: string
          variant_label: string | null
          workspace_id: string
        }
        Insert: {
          assigned_worker_id?: string | null
          brief?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_cost?: number
          credit_type?: Database["public"]["Enums"]["credit_type"]
          duration_ms?: number | null
          execution_id?: string | null
          id?: string
          kind: Database["public"]["Enums"]["creative_kind"]
          output?: Json
          parent_request_id?: string | null
          performance_score?: number | null
          saved_to_library?: boolean
          status?: Database["public"]["Enums"]["creative_status"]
          title: string
          updated_at?: string
          variant_label?: string | null
          workspace_id: string
        }
        Update: {
          assigned_worker_id?: string | null
          brief?: string | null
          campaign_id?: string | null
          created_at?: string
          created_by?: string | null
          credit_cost?: number
          credit_type?: Database["public"]["Enums"]["credit_type"]
          duration_ms?: number | null
          execution_id?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["creative_kind"]
          output?: Json
          parent_request_id?: string | null
          performance_score?: number | null
          saved_to_library?: boolean
          status?: Database["public"]["Enums"]["creative_status"]
          title?: string
          updated_at?: string
          variant_label?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "creative_requests_assigned_worker_id_fkey"
            columns: ["assigned_worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_requests_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_requests_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_requests_parent_request_id_fkey"
            columns: ["parent_request_id"]
            isOneToOne: false
            referencedRelation: "creative_requests"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "creative_requests_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_balances: {
        Row: {
          created_at: string
          credit_type: Database["public"]["Enums"]["credit_type"]
          granted: number
          id: string
          reserved: number
          resets_at: string | null
          unit: string
          updated_at: string
          used: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          credit_type: Database["public"]["Enums"]["credit_type"]
          granted?: number
          id?: string
          reserved?: number
          resets_at?: string | null
          unit?: string
          updated_at?: string
          used?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          credit_type?: Database["public"]["Enums"]["credit_type"]
          granted?: number
          id?: string
          reserved?: number
          resets_at?: string | null
          unit?: string
          updated_at?: string
          used?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_balances_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transactions: {
        Row: {
          actor_id: string | null
          amount: number
          balance_after: number | null
          created_at: string
          credit_type: Database["public"]["Enums"]["credit_type"]
          id: string
          kind: Database["public"]["Enums"]["credit_txn_kind"]
          reason: string | null
          reference_id: string | null
          reference_type: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          amount: number
          balance_after?: number | null
          created_at?: string
          credit_type: Database["public"]["Enums"]["credit_type"]
          id?: string
          kind: Database["public"]["Enums"]["credit_txn_kind"]
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          amount?: number
          balance_after?: number | null
          created_at?: string
          credit_type?: Database["public"]["Enums"]["credit_type"]
          id?: string
          kind?: Database["public"]["Enums"]["credit_txn_kind"]
          reason?: string | null
          reference_id?: string | null
          reference_type?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transactions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      credit_transfers: {
        Row: {
          approved_by: string | null
          created_at: string
          created_by: string | null
          fee: number
          from_amount: number
          from_type: Database["public"]["Enums"]["credit_type"]
          id: string
          note: string | null
          rate: number
          status: Database["public"]["Enums"]["transfer_state"]
          to_amount: number
          to_type: Database["public"]["Enums"]["credit_type"]
          workspace_id: string
        }
        Insert: {
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          fee?: number
          from_amount: number
          from_type: Database["public"]["Enums"]["credit_type"]
          id?: string
          note?: string | null
          rate?: number
          status?: Database["public"]["Enums"]["transfer_state"]
          to_amount: number
          to_type: Database["public"]["Enums"]["credit_type"]
          workspace_id: string
        }
        Update: {
          approved_by?: string | null
          created_at?: string
          created_by?: string | null
          fee?: number
          from_amount?: number
          from_type?: Database["public"]["Enums"]["credit_type"]
          id?: string
          note?: string | null
          rate?: number
          status?: Database["public"]["Enums"]["transfer_state"]
          to_amount?: number
          to_type?: Database["public"]["Enums"]["credit_type"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "credit_transfers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      dashboard_layouts: {
        Row: {
          created_at: string
          id: string
          layout: Json
          scope: string
          updated_at: string
          user_id: string
          workspace_id: string | null
        }
        Insert: {
          created_at?: string
          id?: string
          layout?: Json
          scope?: string
          updated_at?: string
          user_id: string
          workspace_id?: string | null
        }
        Update: {
          created_at?: string
          id?: string
          layout?: Json
          scope?: string
          updated_at?: string
          user_id?: string
          workspace_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "dashboard_layouts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      developer_projects: {
        Row: {
          api_version: string
          created_at: string
          created_by: string | null
          description: string | null
          environment: string
          id: string
          metadata: Json
          name: string
          rate_limit_per_min: number
          slug: string
          status: Database["public"]["Enums"]["developer_project_status"]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          api_version?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          id?: string
          metadata?: Json
          name: string
          rate_limit_per_min?: number
          slug: string
          status?: Database["public"]["Enums"]["developer_project_status"]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          api_version?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          environment?: string
          id?: string
          metadata?: Json
          name?: string
          rate_limit_per_min?: number
          slug?: string
          status?: Database["public"]["Enums"]["developer_project_status"]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "developer_projects_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      environment_variables: {
        Row: {
          created_at: string
          created_by: string | null
          environment: string
          id: string
          is_secret: boolean
          key: string
          project_id: string | null
          updated_at: string
          value: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          environment?: string
          id?: string
          is_secret?: boolean
          key: string
          project_id?: string | null
          updated_at?: string
          value?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          environment?: string
          id?: string
          is_secret?: boolean
          key?: string
          project_id?: string | null
          updated_at?: string
          value?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "environment_variables_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "developer_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "environment_variables_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      execution_steps: {
        Row: {
          attempt: number
          created_at: string
          duration_ms: number | null
          error: string | null
          execution_id: string
          finished_at: string | null
          id: string
          label: string | null
          node_id: string
          node_type: string
          output: Json | null
          seq: number
          started_at: string | null
          status: Database["public"]["Enums"]["execution_status"]
          trace_id: string | null
          workspace_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          execution_id: string
          finished_at?: string | null
          id?: string
          label?: string | null
          node_id: string
          node_type: string
          output?: Json | null
          seq?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          trace_id?: string | null
          workspace_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          duration_ms?: number | null
          error?: string | null
          execution_id?: string
          finished_at?: string | null
          id?: string
          label?: string | null
          node_id?: string
          node_type?: string
          output?: Json | null
          seq?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          trace_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "execution_steps_execution_id_fkey"
            columns: ["execution_id"]
            isOneToOne: false
            referencedRelation: "executions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "execution_steps_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      executions: {
        Row: {
          attempt: number
          cancel_requested: boolean
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          input: Json
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          next_run_at: string
          output: Json | null
          priority: number
          progress: number
          queued_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["execution_status"]
          timeout_seconds: number
          trace_id: string
          trigger: string
          updated_at: string
          warnings: string[]
          worker_id: string | null
          workflow_id: string | null
          workflow_version: number | null
          workspace_id: string
        }
        Insert: {
          attempt?: number
          cancel_requested?: boolean
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          input?: Json
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_run_at?: string
          output?: Json | null
          priority?: number
          progress?: number
          queued_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          timeout_seconds?: number
          trace_id?: string
          trigger?: string
          updated_at?: string
          warnings?: string[]
          worker_id?: string | null
          workflow_id?: string | null
          workflow_version?: number | null
          workspace_id: string
        }
        Update: {
          attempt?: number
          cancel_requested?: boolean
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          idempotency_key?: string | null
          input?: Json
          lease_expires_at?: string | null
          lease_owner?: string | null
          max_attempts?: number
          next_run_at?: string
          output?: Json | null
          priority?: number
          progress?: number
          queued_at?: string
          started_at?: string | null
          status?: Database["public"]["Enums"]["execution_status"]
          timeout_seconds?: number
          trace_id?: string
          trigger?: string
          updated_at?: string
          warnings?: string[]
          worker_id?: string | null
          workflow_id?: string | null
          workflow_version?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "executions_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "executions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_credentials: {
        Row: {
          ciphertext: string
          created_at: string
          fingerprint: string
          id: string
          integration_id: string
          rotated_at: string
          workspace_id: string
        }
        Insert: {
          ciphertext: string
          created_at?: string
          fingerprint: string
          id?: string
          integration_id: string
          rotated_at?: string
          workspace_id: string
        }
        Update: {
          ciphertext?: string
          created_at?: string
          fingerprint?: string
          id?: string
          integration_id?: string
          rotated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_credentials_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: true
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_credentials_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_logs: {
        Row: {
          actor_id: string | null
          attempt: number
          created_at: string
          endpoint: string | null
          id: string
          integration_id: string | null
          kind: Database["public"]["Enums"]["integration_log_kind"]
          latency_ms: number | null
          message: string | null
          method: string | null
          payload: Json | null
          status_code: number | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          attempt?: number
          created_at?: string
          endpoint?: string | null
          id?: string
          integration_id?: string | null
          kind: Database["public"]["Enums"]["integration_log_kind"]
          latency_ms?: number | null
          message?: string | null
          method?: string | null
          payload?: Json | null
          status_code?: number | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          attempt?: number
          created_at?: string
          endpoint?: string | null
          id?: string
          integration_id?: string | null
          kind?: Database["public"]["Enums"]["integration_log_kind"]
          latency_ms?: number | null
          message?: string | null
          method?: string | null
          payload?: Json | null
          status_code?: number | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_logs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_logs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integration_sync_runs: {
        Row: {
          attempt: number
          conflict_strategy: string
          conflicts: number
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          integration_id: string
          max_attempts: number
          mode: Database["public"]["Enums"]["sync_mode"]
          queued_at: string
          records_processed: number
          started_at: string | null
          status: Database["public"]["Enums"]["sync_run_status"]
          workspace_id: string
        }
        Insert: {
          attempt?: number
          conflict_strategy?: string
          conflicts?: number
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          integration_id: string
          max_attempts?: number
          mode?: Database["public"]["Enums"]["sync_mode"]
          queued_at?: string
          records_processed?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_run_status"]
          workspace_id: string
        }
        Update: {
          attempt?: number
          conflict_strategy?: string
          conflicts?: number
          created_at?: string
          created_by?: string | null
          duration_ms?: number | null
          error?: string | null
          finished_at?: string | null
          id?: string
          integration_id?: string
          max_attempts?: number
          mode?: Database["public"]["Enums"]["sync_mode"]
          queued_at?: string
          records_processed?: number
          started_at?: string | null
          status?: Database["public"]["Enums"]["sync_run_status"]
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integration_sync_runs_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "integration_sync_runs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          auth_type: Database["public"]["Enums"]["integration_auth_type"]
          avg_latency_ms: number
          category: string
          config: Json
          created_at: string
          created_by: string | null
          credential_fingerprint: string | null
          credential_updated_at: string | null
          description: string | null
          enabled: boolean
          environment: string
          error_count: number
          expires_at: string | null
          id: string
          last_checked_at: string | null
          last_error: string | null
          last_sync_at: string | null
          name: string
          provider: string
          request_count: number
          scopes: string[]
          status: Database["public"]["Enums"]["integration_status"]
          sync_interval_minutes: number
          sync_mode: Database["public"]["Enums"]["sync_mode"]
          tags: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          auth_type?: Database["public"]["Enums"]["integration_auth_type"]
          avg_latency_ms?: number
          category: string
          config?: Json
          created_at?: string
          created_by?: string | null
          credential_fingerprint?: string | null
          credential_updated_at?: string | null
          description?: string | null
          enabled?: boolean
          environment?: string
          error_count?: number
          expires_at?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          name: string
          provider: string
          request_count?: number
          scopes?: string[]
          status?: Database["public"]["Enums"]["integration_status"]
          sync_interval_minutes?: number
          sync_mode?: Database["public"]["Enums"]["sync_mode"]
          tags?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          auth_type?: Database["public"]["Enums"]["integration_auth_type"]
          avg_latency_ms?: number
          category?: string
          config?: Json
          created_at?: string
          created_by?: string | null
          credential_fingerprint?: string | null
          credential_updated_at?: string | null
          description?: string | null
          enabled?: boolean
          environment?: string
          error_count?: number
          expires_at?: string | null
          id?: string
          last_checked_at?: string | null
          last_error?: string | null
          last_sync_at?: string | null
          name?: string
          provider?: string
          request_count?: number
          scopes?: string[]
          status?: Database["public"]["Enums"]["integration_status"]
          sync_interval_minutes?: number
          sync_mode?: Database["public"]["Enums"]["sync_mode"]
          tags?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoice_items: {
        Row: {
          amount: number
          category: Database["public"]["Enums"]["usage_category"] | null
          created_at: string
          description: string
          id: string
          invoice_id: string
          quantity: number
          unit_price: number
          workspace_id: string
        }
        Insert: {
          amount?: number
          category?: Database["public"]["Enums"]["usage_category"] | null
          created_at?: string
          description: string
          id?: string
          invoice_id: string
          quantity?: number
          unit_price?: number
          workspace_id: string
        }
        Update: {
          amount?: number
          category?: Database["public"]["Enums"]["usage_category"] | null
          created_at?: string
          description?: string
          id?: string
          invoice_id?: string
          quantity?: number
          unit_price?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoice_items_invoice_id_fkey"
            columns: ["invoice_id"]
            isOneToOne: false
            referencedRelation: "invoices"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoice_items_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      invoices: {
        Row: {
          created_at: string
          created_by: string | null
          currency: string
          due_at: string | null
          id: string
          issued_at: string | null
          notes: string | null
          number: string
          paid_at: string | null
          payment_provider: Database["public"]["Enums"]["payment_provider"]
          period_end: string | null
          period_start: string | null
          scope: Database["public"]["Enums"]["billing_scope"]
          status: Database["public"]["Enums"]["invoice_status"]
          subscription_id: string | null
          subtotal: number
          tax_amount: number
          tax_rate: number
          total: number
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          currency?: string
          due_at?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          number: string
          paid_at?: string | null
          payment_provider?: Database["public"]["Enums"]["payment_provider"]
          period_end?: string | null
          period_start?: string | null
          scope?: Database["public"]["Enums"]["billing_scope"]
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          currency?: string
          due_at?: string | null
          id?: string
          issued_at?: string | null
          notes?: string | null
          number?: string
          paid_at?: string | null
          payment_provider?: Database["public"]["Enums"]["payment_provider"]
          period_end?: string | null
          period_start?: string | null
          scope?: Database["public"]["Enums"]["billing_scope"]
          status?: Database["public"]["Enums"]["invoice_status"]
          subscription_id?: string | null
          subtotal?: number
          tax_amount?: number
          tax_rate?: number
          total?: number
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "invoices_subscription_id_fkey"
            columns: ["subscription_id"]
            isOneToOne: false
            referencedRelation: "billing_subscriptions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "invoices_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_base_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          knowledge_base_id: string
          label: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          knowledge_base_id: string
          label?: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          knowledge_base_id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_base_versions_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_base_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_bases: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          name: string
          status: Database["public"]["Enums"]["knowledge_status"]
          tags: string[]
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          name?: string
          status?: Database["public"]["Enums"]["knowledge_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_bases_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_document_versions: {
        Row: {
          created_at: string
          created_by: string | null
          document_id: string
          id: string
          label: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          document_id: string
          id?: string
          label?: string | null
          snapshot: Json
          version: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          document_id?: string
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_document_versions_document_id_fkey"
            columns: ["document_id"]
            isOneToOne: false
            referencedRelation: "knowledge_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_document_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_documents: {
        Row: {
          archived: boolean
          chunk_count: number
          content: string | null
          created_at: string
          created_by: string | null
          description: string | null
          error: string | null
          folder_id: string | null
          id: string
          indexed_at: string | null
          knowledge_base_id: string
          last_used_at: string | null
          mime_type: string | null
          name: string
          size_bytes: number
          source: Database["public"]["Enums"]["knowledge_source"]
          source_url: string | null
          status: Database["public"]["Enums"]["document_status"]
          storage_path: string | null
          tags: string[]
          token_estimate: number
          updated_at: string
          usage_count: number
          version: number
          workspace_id: string
        }
        Insert: {
          archived?: boolean
          chunk_count?: number
          content?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          error?: string | null
          folder_id?: string | null
          id?: string
          indexed_at?: string | null
          knowledge_base_id: string
          last_used_at?: string | null
          mime_type?: string | null
          name: string
          size_bytes?: number
          source?: Database["public"]["Enums"]["knowledge_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tags?: string[]
          token_estimate?: number
          updated_at?: string
          usage_count?: number
          version?: number
          workspace_id: string
        }
        Update: {
          archived?: boolean
          chunk_count?: number
          content?: string | null
          created_at?: string
          created_by?: string | null
          description?: string | null
          error?: string | null
          folder_id?: string | null
          id?: string
          indexed_at?: string | null
          knowledge_base_id?: string
          last_used_at?: string | null
          mime_type?: string | null
          name?: string
          size_bytes?: number
          source?: Database["public"]["Enums"]["knowledge_source"]
          source_url?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          storage_path?: string | null
          tags?: string[]
          token_estimate?: number
          updated_at?: string
          usage_count?: number
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_documents_folder_id_fkey"
            columns: ["folder_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_documents_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      knowledge_folders: {
        Row: {
          created_at: string
          id: string
          knowledge_base_id: string
          name: string
          parent_id: string | null
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          knowledge_base_id: string
          name: string
          parent_id?: string | null
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          knowledge_base_id?: string
          name?: string
          parent_id?: string | null
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "knowledge_folders_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_folders_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "knowledge_folders"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "knowledge_folders_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_alerts: {
        Row: {
          action_key: string | null
          action_payload: Json
          campaign_id: string | null
          created_at: string
          expected_impact: string | null
          id: string
          kind: Database["public"]["Enums"]["marketing_alert_kind"]
          reason: string | null
          recommended_action: string | null
          resolved: boolean
          severity: Database["public"]["Enums"]["marketing_alert_severity"]
          title: string
          workspace_id: string
        }
        Insert: {
          action_key?: string | null
          action_payload?: Json
          campaign_id?: string | null
          created_at?: string
          expected_impact?: string | null
          id?: string
          kind: Database["public"]["Enums"]["marketing_alert_kind"]
          reason?: string | null
          recommended_action?: string | null
          resolved?: boolean
          severity?: Database["public"]["Enums"]["marketing_alert_severity"]
          title: string
          workspace_id: string
        }
        Update: {
          action_key?: string | null
          action_payload?: Json
          campaign_id?: string | null
          created_at?: string
          expected_impact?: string | null
          id?: string
          kind?: Database["public"]["Enums"]["marketing_alert_kind"]
          reason?: string | null
          recommended_action?: string | null
          resolved?: boolean
          severity?: Database["public"]["Enums"]["marketing_alert_severity"]
          title?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_alerts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "marketing_campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_alerts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_audit_log: {
        Row: {
          action: string
          actor_user_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: string
          id: string
          metadata: Json
          reason: string | null
          workspace_id: string
        }
        Insert: {
          action: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: string
          id?: string
          metadata?: Json
          reason?: string | null
          workspace_id: string
        }
        Update: {
          action?: string
          actor_user_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: string
          id?: string
          metadata?: Json
          reason?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_audit_log_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketing_campaigns: {
        Row: {
          budget_spent: number
          budget_total: number
          channel: Database["public"]["Enums"]["marketing_channel"]
          coordinator_worker_id: string | null
          created_at: string
          currency: string
          ends_at: string | null
          id: string
          metadata: Json
          name: string
          objective: string | null
          owner_user_id: string | null
          revenue: number
          starts_at: string | null
          status: Database["public"]["Enums"]["marketing_campaign_status"]
          tags: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          budget_spent?: number
          budget_total?: number
          channel?: Database["public"]["Enums"]["marketing_channel"]
          coordinator_worker_id?: string | null
          created_at?: string
          currency?: string
          ends_at?: string | null
          id?: string
          metadata?: Json
          name: string
          objective?: string | null
          owner_user_id?: string | null
          revenue?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["marketing_campaign_status"]
          tags?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          budget_spent?: number
          budget_total?: number
          channel?: Database["public"]["Enums"]["marketing_channel"]
          coordinator_worker_id?: string | null
          created_at?: string
          currency?: string
          ends_at?: string | null
          id?: string
          metadata?: Json
          name?: string
          objective?: string | null
          owner_user_id?: string | null
          revenue?: number
          starts_at?: string | null
          status?: Database["public"]["Enums"]["marketing_campaign_status"]
          tags?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketing_campaigns_coordinator_worker_id_fkey"
            columns: ["coordinator_worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketing_campaigns_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_installs: {
        Row: {
          created_at: string
          id: string
          installed_by: string | null
          license: Database["public"]["Enums"]["marketplace_license"]
          product_id: string
          status: string
          version: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          installed_by?: string | null
          license?: Database["public"]["Enums"]["marketplace_license"]
          product_id: string
          status?: string
          version?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          installed_by?: string | null
          license?: Database["public"]["Enums"]["marketplace_license"]
          product_id?: string
          status?: string
          version?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_installs_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_installs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_listings: {
        Row: {
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          install_count: number
          manifest: Json
          name: string
          publisher: string
          slug: string
          status: Database["public"]["Enums"]["marketplace_listing_status"]
          updated_at: string
          version: string
          workspace_id: string
        }
        Insert: {
          category: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          install_count?: number
          manifest?: Json
          name: string
          publisher: string
          slug: string
          status?: Database["public"]["Enums"]["marketplace_listing_status"]
          updated_at?: string
          version?: string
          workspace_id: string
        }
        Update: {
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          install_count?: number
          manifest?: Json
          name?: string
          publisher?: string
          slug?: string
          status?: Database["public"]["Enums"]["marketplace_listing_status"]
          updated_at?: string
          version?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_listings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_product_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          product_id: string
          release_notes: string | null
          snapshot: Json
          version: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id: string
          release_notes?: string | null
          snapshot?: Json
          version: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          product_id?: string
          release_notes?: string | null
          snapshot?: Json
          version?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_product_versions_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_product_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_products: {
        Row: {
          category: Database["public"]["Enums"]["marketplace_category"]
          compatibility: string | null
          created_at: string
          created_by: string | null
          currency: string
          description: string | null
          developer: string
          featured: boolean
          id: string
          install_count: number
          license: Database["public"]["Enums"]["marketplace_license"]
          manifest: Json
          name: string
          price_cents: number
          published_at: string | null
          rating_avg: number
          rating_count: number
          release_notes: string | null
          revenue_cents: number
          screenshots: Json
          slug: string
          status: Database["public"]["Enums"]["marketplace_listing_status"]
          summary: string | null
          tags: string[]
          updated_at: string
          verified: boolean
          version: string
          workspace_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["marketplace_category"]
          compatibility?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          developer: string
          featured?: boolean
          id?: string
          install_count?: number
          license?: Database["public"]["Enums"]["marketplace_license"]
          manifest?: Json
          name: string
          price_cents?: number
          published_at?: string | null
          rating_avg?: number
          rating_count?: number
          release_notes?: string | null
          revenue_cents?: number
          screenshots?: Json
          slug: string
          status?: Database["public"]["Enums"]["marketplace_listing_status"]
          summary?: string | null
          tags?: string[]
          updated_at?: string
          verified?: boolean
          version?: string
          workspace_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["marketplace_category"]
          compatibility?: string | null
          created_at?: string
          created_by?: string | null
          currency?: string
          description?: string | null
          developer?: string
          featured?: boolean
          id?: string
          install_count?: number
          license?: Database["public"]["Enums"]["marketplace_license"]
          manifest?: Json
          name?: string
          price_cents?: number
          published_at?: string | null
          rating_avg?: number
          rating_count?: number
          release_notes?: string | null
          revenue_cents?: number
          screenshots?: Json
          slug?: string
          status?: Database["public"]["Enums"]["marketplace_listing_status"]
          summary?: string | null
          tags?: string[]
          updated_at?: string
          verified?: boolean
          version?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_products_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      marketplace_reviews: {
        Row: {
          comment: string | null
          created_at: string
          id: string
          product_id: string
          rating: number
          reported: boolean
          updated_at: string
          user_id: string
          verified_purchase: boolean
          workspace_id: string
        }
        Insert: {
          comment?: string | null
          created_at?: string
          id?: string
          product_id: string
          rating: number
          reported?: boolean
          updated_at?: string
          user_id: string
          verified_purchase?: boolean
          workspace_id: string
        }
        Update: {
          comment?: string | null
          created_at?: string
          id?: string
          product_id?: string
          rating?: number
          reported?: boolean
          updated_at?: string
          user_id?: string
          verified_purchase?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "marketplace_reviews_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "marketplace_products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "marketplace_reviews_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      member_roles: {
        Row: {
          created_at: string
          id: string
          member_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          member_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          member_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "member_roles_member_id_fkey"
            columns: ["member_id"]
            isOneToOne: false
            referencedRelation: "workspace_members"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "member_roles_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_entries: {
        Row: {
          content: string
          created_at: string
          created_by: string | null
          expires_at: string | null
          id: string
          importance: number
          key: string
          last_used_at: string | null
          read_count: number
          size_bytes: number
          status: Database["public"]["Enums"]["memory_entry_status"]
          store_id: string
          updated_at: string
          worker_id: string | null
          workspace_id: string
          write_count: number
        }
        Insert: {
          content: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          importance?: number
          key: string
          last_used_at?: string | null
          read_count?: number
          size_bytes?: number
          status?: Database["public"]["Enums"]["memory_entry_status"]
          store_id: string
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
          write_count?: number
        }
        Update: {
          content?: string
          created_at?: string
          created_by?: string | null
          expires_at?: string | null
          id?: string
          importance?: number
          key?: string
          last_used_at?: string | null
          read_count?: number
          size_bytes?: number
          status?: Database["public"]["Enums"]["memory_entry_status"]
          store_id?: string
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
          write_count?: number
        }
        Relationships: [
          {
            foreignKeyName: "memory_entries_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "memory_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_entries_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_entries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_events: {
        Row: {
          actor_id: string | null
          created_at: string
          detail: string | null
          entry_id: string | null
          event: Database["public"]["Enums"]["memory_event_type"]
          id: string
          store_id: string | null
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entry_id?: string | null
          event: Database["public"]["Enums"]["memory_event_type"]
          id?: string
          store_id?: string | null
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          entry_id?: string | null
          event?: Database["public"]["Enums"]["memory_event_type"]
          id?: string
          store_id?: string | null
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_events_entry_id_fkey"
            columns: ["entry_id"]
            isOneToOne: false
            referencedRelation: "memory_entries"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_events_store_id_fkey"
            columns: ["store_id"]
            isOneToOne: false
            referencedRelation: "memory_stores"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_events_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_events_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      memory_stores: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          enabled: boolean
          id: string
          layer: Database["public"]["Enums"]["memory_layer"]
          max_items: number
          name: string
          priority: number
          retention_days: number
          updated_at: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          layer?: Database["public"]["Enums"]["memory_layer"]
          max_items?: number
          name: string
          priority?: number
          retention_days?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          layer?: Database["public"]["Enums"]["memory_layer"]
          max_items?: number
          name?: string
          priority?: number
          retention_days?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "memory_stores_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "memory_stores_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      model_configs: {
        Row: {
          created_at: string
          created_by: string | null
          frequency_penalty: number
          id: string
          is_default: boolean
          max_tokens: number
          model: string
          name: string
          presence_penalty: number
          provider: string
          stop_sequences: string[]
          streaming: boolean
          temperature: number
          top_p: number
          updated_at: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          frequency_penalty?: number
          id?: string
          is_default?: boolean
          max_tokens?: number
          model?: string
          name: string
          presence_penalty?: number
          provider?: string
          stop_sequences?: string[]
          streaming?: boolean
          temperature?: number
          top_p?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          frequency_penalty?: number
          id?: string
          is_default?: boolean
          max_tokens?: number
          model?: string
          name?: string
          presence_penalty?: number
          provider?: string
          stop_sequences?: string[]
          streaming?: boolean
          temperature?: number
          top_p?: number
          updated_at?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "model_configs_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "model_configs_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      oauth_clients: {
        Row: {
          client_id: string
          created_at: string
          created_by: string | null
          grant_types: string[]
          id: string
          last_rotated_at: string | null
          name: string
          project_id: string | null
          redirect_uris: string[]
          scopes: string[]
          secret_hash: string | null
          secret_preview: string | null
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          client_id: string
          created_at?: string
          created_by?: string | null
          grant_types?: string[]
          id?: string
          last_rotated_at?: string | null
          name: string
          project_id?: string | null
          redirect_uris?: string[]
          scopes?: string[]
          secret_hash?: string | null
          secret_preview?: string | null
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          client_id?: string
          created_at?: string
          created_by?: string | null
          grant_types?: string[]
          id?: string
          last_rotated_at?: string | null
          name?: string
          project_id?: string | null
          redirect_uris?: string[]
          scopes?: string[]
          secret_hash?: string | null
          secret_preview?: string | null
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "oauth_clients_project_id_fkey"
            columns: ["project_id"]
            isOneToOne: false
            referencedRelation: "developer_projects"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "oauth_clients_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      payment_methods: {
        Row: {
          created_at: string
          created_by: string | null
          credential_fingerprint: string | null
          fingerprint: string | null
          id: string
          is_default: boolean
          label: string
          metadata: Json
          provider: Database["public"]["Enums"]["payment_provider"]
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          credential_fingerprint?: string | null
          fingerprint?: string | null
          id?: string
          is_default?: boolean
          label: string
          metadata?: Json
          provider: Database["public"]["Enums"]["payment_provider"]
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          credential_fingerprint?: string | null
          fingerprint?: string | null
          id?: string
          is_default?: boolean
          label?: string
          metadata?: Json
          provider?: Database["public"]["Enums"]["payment_provider"]
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "payment_methods_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      permissions: {
        Row: {
          created_at: string
          description: string | null
          id: string
          key: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          key: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          key?: string
        }
        Relationships: []
      }
      plugins: {
        Row: {
          created_at: string
          dependencies: string[]
          description: string | null
          id: string
          installed_by: string | null
          latest_version: string
          manifest: Json
          name: string
          permissions: string[]
          publisher: string
          slug: string
          status: Database["public"]["Enums"]["plugin_status"]
          updated_at: string
          version: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          dependencies?: string[]
          description?: string | null
          id?: string
          installed_by?: string | null
          latest_version?: string
          manifest?: Json
          name: string
          permissions?: string[]
          publisher?: string
          slug: string
          status?: Database["public"]["Enums"]["plugin_status"]
          updated_at?: string
          version?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          dependencies?: string[]
          description?: string | null
          id?: string
          installed_by?: string | null
          latest_version?: string
          manifest?: Json
          name?: string
          permissions?: string[]
          publisher?: string
          slug?: string
          status?: Database["public"]["Enums"]["plugin_status"]
          updated_at?: string
          version?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "plugins_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          last_login: string | null
          status: string
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          last_login?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          last_login?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      prompt_versions: {
        Row: {
          body: string
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          prompt_id: string
          variables: Json
          version: number
          workspace_id: string
        }
        Insert: {
          body: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          prompt_id: string
          variables?: Json
          version: number
          workspace_id: string
        }
        Update: {
          body?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          prompt_id?: string
          variables?: Json
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompt_versions_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompt_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          body: string
          category: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_template: boolean
          name: string
          scope: Database["public"]["Enums"]["prompt_scope"]
          tags: string[]
          updated_at: string
          variables: Json
          version: number
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_template?: boolean
          name: string
          scope?: Database["public"]["Enums"]["prompt_scope"]
          tags?: string[]
          updated_at?: string
          variables?: Json
          version?: number
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          body?: string
          category?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_template?: boolean
          name?: string
          scope?: Database["public"]["Enums"]["prompt_scope"]
          tags?: string[]
          updated_at?: string
          variables?: Json
          version?: number
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "prompts_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "prompts_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_id: string
          role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_id: string
          role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_id?: string
          role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "role_permissions_permission_id_fkey"
            columns: ["permission_id"]
            isOneToOne: false
            referencedRelation: "permissions"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "role_permissions_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
        ]
      }
      roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      usage_records: {
        Row: {
          category: Database["public"]["Enums"]["usage_category"]
          created_at: string
          credit_type: Database["public"]["Enums"]["credit_type"]
          id: string
          metadata: Json
          occurred_on: string
          quantity: number
          reference_id: string | null
          reference_type: string | null
          total_cost: number
          unit: string
          unit_cost: number
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          category: Database["public"]["Enums"]["usage_category"]
          created_at?: string
          credit_type?: Database["public"]["Enums"]["credit_type"]
          id?: string
          metadata?: Json
          occurred_on?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          total_cost?: number
          unit?: string
          unit_cost?: number
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          category?: Database["public"]["Enums"]["usage_category"]
          created_at?: string
          credit_type?: Database["public"]["Enums"]["credit_type"]
          id?: string
          metadata?: Json
          occurred_on?: string
          quantity?: number
          reference_id?: string | null
          reference_type?: string | null
          total_cost?: number
          unit?: string
          unit_cost?: number
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "usage_records_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "usage_records_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_calls: {
        Row: {
          answered_at: string | null
          cost: number
          created_at: string
          direction: Database["public"]["Enums"]["call_direction"]
          duration_seconds: number
          ended_at: string | null
          error: string | null
          from_number: string
          id: string
          metadata: Json
          number_id: string | null
          profile_id: string | null
          provider_id: string | null
          recording_path: string | null
          result: string | null
          started_at: string | null
          status: Database["public"]["Enums"]["call_status"]
          to_number: string
          transcript: string | null
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          answered_at?: string | null
          cost?: number
          created_at?: string
          direction: Database["public"]["Enums"]["call_direction"]
          duration_seconds?: number
          ended_at?: string | null
          error?: string | null
          from_number: string
          id?: string
          metadata?: Json
          number_id?: string | null
          profile_id?: string | null
          provider_id?: string | null
          recording_path?: string | null
          result?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          to_number: string
          transcript?: string | null
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          answered_at?: string | null
          cost?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["call_direction"]
          duration_seconds?: number
          ended_at?: string | null
          error?: string | null
          from_number?: string
          id?: string
          metadata?: Json
          number_id?: string | null
          profile_id?: string | null
          provider_id?: string | null
          recording_path?: string | null
          result?: string | null
          started_at?: string | null
          status?: Database["public"]["Enums"]["call_status"]
          to_number?: string
          transcript?: string | null
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_calls_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "voice_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_profile_id_fkey"
            columns: ["profile_id"]
            isOneToOne: false
            referencedRelation: "voice_profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "voice_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_calls_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_numbers: {
        Row: {
          capabilities: string[]
          connected_at: string | null
          country: string
          created_at: string
          created_by: string | null
          id: string
          label: string
          monthly_cost: number
          notes: string | null
          number_type: Database["public"]["Enums"]["voice_number_type"]
          phone_number: string
          provider_id: string | null
          status: Database["public"]["Enums"]["voice_number_status"]
          tags: string[]
          updated_at: string
          verified_at: string | null
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          capabilities?: string[]
          connected_at?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label: string
          monthly_cost?: number
          notes?: string | null
          number_type?: Database["public"]["Enums"]["voice_number_type"]
          phone_number: string
          provider_id?: string | null
          status?: Database["public"]["Enums"]["voice_number_status"]
          tags?: string[]
          updated_at?: string
          verified_at?: string | null
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          capabilities?: string[]
          connected_at?: string | null
          country?: string
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string
          monthly_cost?: number
          notes?: string | null
          number_type?: Database["public"]["Enums"]["voice_number_type"]
          phone_number?: string
          provider_id?: string | null
          status?: Database["public"]["Enums"]["voice_number_status"]
          tags?: string[]
          updated_at?: string
          verified_at?: string | null
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_numbers_provider_id_fkey"
            columns: ["provider_id"]
            isOneToOne: false
            referencedRelation: "voice_providers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_numbers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_numbers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_profiles: {
        Row: {
          accent: string
          created_at: string
          created_by: string | null
          enabled: boolean
          greeting: string | null
          id: string
          language: string
          max_call_duration_seconds: number
          name: string
          number_id: string | null
          recording_policy: string
          silence_timeout_seconds: number
          transfer_rules: Json
          updated_at: string
          voice: string
          worker_id: string | null
          workspace_id: string
        }
        Insert: {
          accent?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          greeting?: string | null
          id?: string
          language?: string
          max_call_duration_seconds?: number
          name: string
          number_id?: string | null
          recording_policy?: string
          silence_timeout_seconds?: number
          transfer_rules?: Json
          updated_at?: string
          voice?: string
          worker_id?: string | null
          workspace_id: string
        }
        Update: {
          accent?: string
          created_at?: string
          created_by?: string | null
          enabled?: boolean
          greeting?: string | null
          id?: string
          language?: string
          max_call_duration_seconds?: number
          name?: string
          number_id?: string | null
          recording_policy?: string
          silence_timeout_seconds?: number
          transfer_rules?: Json
          updated_at?: string
          voice?: string
          worker_id?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_profiles_number_id_fkey"
            columns: ["number_id"]
            isOneToOne: false
            referencedRelation: "voice_numbers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_profiles_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_profiles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      voice_providers: {
        Row: {
          capabilities: string[]
          config: Json
          created_at: string
          created_by: string | null
          credential_fingerprint: string | null
          credential_updated_at: string | null
          description: string | null
          enabled: boolean
          id: string
          integration_id: string | null
          kind: Database["public"]["Enums"]["voice_provider_kind"]
          last_checked_at: string | null
          last_error: string | null
          name: string
          region: string
          status: Database["public"]["Enums"]["voice_provider_status"]
          tags: string[]
          updated_at: string
          workspace_id: string
        }
        Insert: {
          capabilities?: string[]
          config?: Json
          created_at?: string
          created_by?: string | null
          credential_fingerprint?: string | null
          credential_updated_at?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          integration_id?: string | null
          kind: Database["public"]["Enums"]["voice_provider_kind"]
          last_checked_at?: string | null
          last_error?: string | null
          name: string
          region?: string
          status?: Database["public"]["Enums"]["voice_provider_status"]
          tags?: string[]
          updated_at?: string
          workspace_id: string
        }
        Update: {
          capabilities?: string[]
          config?: Json
          created_at?: string
          created_by?: string | null
          credential_fingerprint?: string | null
          credential_updated_at?: string | null
          description?: string | null
          enabled?: boolean
          id?: string
          integration_id?: string | null
          kind?: Database["public"]["Enums"]["voice_provider_kind"]
          last_checked_at?: string | null
          last_error?: string | null
          name?: string
          region?: string
          status?: Database["public"]["Enums"]["voice_provider_status"]
          tags?: string[]
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "voice_providers_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "voice_providers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_deliveries: {
        Row: {
          attempt: number
          created_at: string
          direction: Database["public"]["Enums"]["webhook_direction"]
          endpoint_id: string
          error: string | null
          event: string
          id: string
          latency_ms: number | null
          payload: Json | null
          signature_valid: boolean | null
          status_code: number | null
          success: boolean
          workspace_id: string
        }
        Insert: {
          attempt?: number
          created_at?: string
          direction: Database["public"]["Enums"]["webhook_direction"]
          endpoint_id: string
          error?: string | null
          event: string
          id?: string
          latency_ms?: number | null
          payload?: Json | null
          signature_valid?: boolean | null
          status_code?: number | null
          success?: boolean
          workspace_id: string
        }
        Update: {
          attempt?: number
          created_at?: string
          direction?: Database["public"]["Enums"]["webhook_direction"]
          endpoint_id?: string
          error?: string | null
          event?: string
          id?: string
          latency_ms?: number | null
          payload?: Json | null
          signature_valid?: boolean | null
          status_code?: number | null
          success?: boolean
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_deliveries_endpoint_id_fkey"
            columns: ["endpoint_id"]
            isOneToOne: false
            referencedRelation: "webhook_endpoints"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_deliveries_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      webhook_endpoints: {
        Row: {
          created_at: string
          created_by: string | null
          direction: Database["public"]["Enums"]["webhook_direction"]
          enabled: boolean
          events: string[]
          id: string
          integration_id: string | null
          last_delivery_at: string | null
          name: string
          retry_limit: number
          signing_secret_hint: string | null
          slug: string
          timeout_seconds: number
          updated_at: string
          url: string | null
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["webhook_direction"]
          enabled?: boolean
          events?: string[]
          id?: string
          integration_id?: string | null
          last_delivery_at?: string | null
          name: string
          retry_limit?: number
          signing_secret_hint?: string | null
          slug: string
          timeout_seconds?: number
          updated_at?: string
          url?: string | null
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          direction?: Database["public"]["Enums"]["webhook_direction"]
          enabled?: boolean
          events?: string[]
          id?: string
          integration_id?: string | null
          last_delivery_at?: string | null
          name?: string
          retry_limit?: number
          signing_secret_hint?: string | null
          slug?: string
          timeout_seconds?: number
          updated_at?: string
          url?: string | null
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "webhook_endpoints_integration_id_fkey"
            columns: ["integration_id"]
            isOneToOne: false
            referencedRelation: "integrations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "webhook_endpoints_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_activity: {
        Row: {
          action: string
          actor_id: string | null
          created_at: string
          detail: string | null
          id: string
          worker_id: string
          workspace_id: string
        }
        Insert: {
          action: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          worker_id: string
          workspace_id: string
        }
        Update: {
          action?: string
          actor_id?: string | null
          created_at?: string
          detail?: string | null
          id?: string
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_activity_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_activity_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_knowledge: {
        Row: {
          created_at: string
          enabled: boolean
          id: string
          is_default: boolean
          knowledge_base_id: string
          priority: number
          updated_at: string
          worker_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          knowledge_base_id: string
          priority?: number
          updated_at?: string
          worker_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          enabled?: boolean
          id?: string
          is_default?: boolean
          knowledge_base_id?: string
          priority?: number
          updated_at?: string
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_knowledge_knowledge_base_id_fkey"
            columns: ["knowledge_base_id"]
            isOneToOne: false
            referencedRelation: "knowledge_bases"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_knowledge_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_knowledge_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_notes: {
        Row: {
          author_id: string | null
          body: string
          created_at: string
          id: string
          worker_id: string
          workspace_id: string
        }
        Insert: {
          author_id?: string | null
          body: string
          created_at?: string
          id?: string
          worker_id: string
          workspace_id: string
        }
        Update: {
          author_id?: string | null
          body?: string
          created_at?: string
          id?: string
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_notes_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_notes_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      worker_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          snapshot: Json
          version: number
          worker_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          worker_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          worker_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "worker_versions_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "worker_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_versions: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          label: string | null
          snapshot: Json
          version: number
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot: Json
          version: number
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          label?: string | null
          snapshot?: Json
          version?: number
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_versions_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_versions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflow_workers: {
        Row: {
          created_at: string
          id: string
          worker_id: string
          workflow_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          worker_id: string
          workflow_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          worker_id?: string
          workflow_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflow_workers_worker_id_fkey"
            columns: ["worker_id"]
            isOneToOne: false
            referencedRelation: "ai_workers"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_workers_workflow_id_fkey"
            columns: ["workflow_id"]
            isOneToOne: false
            referencedRelation: "workflows"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workflow_workers_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workflows: {
        Row: {
          created_at: string
          created_by: string | null
          description: string | null
          graph: Json
          id: string
          name: string
          published_at: string | null
          status: Database["public"]["Enums"]["workflow_status"]
          tags: string[]
          updated_at: string
          version: number
          workspace_id: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          graph?: Json
          id?: string
          name: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["workflow_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          description?: string | null
          graph?: Json
          id?: string
          name?: string
          published_at?: string | null
          status?: Database["public"]["Enums"]["workflow_status"]
          tags?: string[]
          updated_at?: string
          version?: number
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workflows_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_invitations: {
        Row: {
          created_at: string
          email: string
          id: string
          invited_by: string | null
          role: Database["public"]["Enums"]["workspace_role"]
          status: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          email: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          email?: string
          id?: string
          invited_by?: string | null
          role?: Database["public"]["Enums"]["workspace_role"]
          status?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_invitations_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_members: {
        Row: {
          created_at: string
          id: string
          role: Database["public"]["Enums"]["workspace_role"]
          role_id: string | null
          status: string
          user_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          role_id?: string | null
          status?: string
          user_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          id?: string
          role?: Database["public"]["Enums"]["workspace_role"]
          role_id?: string | null
          status?: string
          user_id?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_members_role_id_fkey"
            columns: ["role_id"]
            isOneToOne: false
            referencedRelation: "roles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_members_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_role_permissions: {
        Row: {
          created_at: string
          id: string
          permission_key: string
          workspace_id: string
          workspace_role_id: string
        }
        Insert: {
          created_at?: string
          id?: string
          permission_key: string
          workspace_id: string
          workspace_role_id: string
        }
        Update: {
          created_at?: string
          id?: string
          permission_key?: string
          workspace_id?: string
          workspace_role_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_role_permissions_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "workspace_role_permissions_workspace_role_id_fkey"
            columns: ["workspace_role_id"]
            isOneToOne: false
            referencedRelation: "workspace_roles"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_roles: {
        Row: {
          created_at: string
          description: string | null
          id: string
          name: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id?: string
          name: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_roles_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: false
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspace_settings: {
        Row: {
          brand_color: string | null
          created_at: string
          domain: string | null
          language: string
          region: string
          timezone: string
          updated_at: string
          workspace_id: string
        }
        Insert: {
          brand_color?: string | null
          created_at?: string
          domain?: string | null
          language?: string
          region?: string
          timezone?: string
          updated_at?: string
          workspace_id: string
        }
        Update: {
          brand_color?: string | null
          created_at?: string
          domain?: string | null
          language?: string
          region?: string
          timezone?: string
          updated_at?: string
          workspace_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "workspace_settings_workspace_id_fkey"
            columns: ["workspace_id"]
            isOneToOne: true
            referencedRelation: "workspaces"
            referencedColumns: ["id"]
          },
        ]
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          logo: string | null
          name: string
          owner_user_id: string
          slug: string
          status: string
          subscription_plan: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          logo?: string | null
          name: string
          owner_user_id: string
          slug: string
          status?: string
          subscription_plan?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          logo?: string | null
          name?: string
          owner_user_id?: string
          slug?: string
          status?: string
          subscription_plan?: string
          updated_at?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      claim_executions: {
        Args: { _lease_owner: string; _lease_seconds?: number; _limit?: number }
        Returns: {
          attempt: number
          cancel_requested: boolean
          created_at: string
          created_by: string | null
          duration_ms: number | null
          error: string | null
          finished_at: string | null
          id: string
          idempotency_key: string | null
          input: Json
          lease_expires_at: string | null
          lease_owner: string | null
          max_attempts: number
          next_run_at: string
          output: Json | null
          priority: number
          progress: number
          queued_at: string
          started_at: string | null
          status: Database["public"]["Enums"]["execution_status"]
          timeout_seconds: number
          trace_id: string
          trigger: string
          updated_at: string
          warnings: string[]
          worker_id: string | null
          workflow_id: string | null
          workflow_version: number | null
          workspace_id: string
        }[]
        SetofOptions: {
          from: "*"
          to: "executions"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      create_workspace: {
        Args: { _name: string; _slug: string }
        Returns: string
      }
      has_workspace_role: {
        Args: {
          _roles: Database["public"]["Enums"]["workspace_role"][]
          _user_id: string
          _workspace_id: string
        }
        Returns: boolean
      }
      is_workspace_member: {
        Args: { _user_id: string; _workspace_id: string }
        Returns: boolean
      }
      member_workspace: { Args: { _member_id: string }; Returns: string }
      reap_stale_executions: { Args: never; Returns: number }
      report_marketplace_review: {
        Args: { _review_id: string }
        Returns: undefined
      }
      shares_workspace: {
        Args: { _other_user_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      approval_state: "pending" | "approved" | "rejected" | "cancelled"
      billing_scope:
        | "workspace"
        | "organization"
        | "owner"
        | "developer"
        | "reseller"
      call_direction: "inbound" | "outbound"
      call_status:
        | "queued"
        | "ringing"
        | "in_progress"
        | "completed"
        | "failed"
        | "missed"
        | "cancelled"
        | "no_answer"
      creative_kind:
        | "image"
        | "video"
        | "reel"
        | "short_video"
        | "copywriting"
        | "ad_copy"
        | "social_post"
        | "banner"
        | "landing_page"
        | "email_campaign"
        | "whatsapp_message"
        | "sms_campaign"
        | "multi_platform"
      creative_status:
        | "draft"
        | "queued"
        | "running"
        | "review"
        | "approved"
        | "rejected"
        | "failed"
        | "archived"
      credit_txn_kind:
        | "grant"
        | "purchase"
        | "consumption"
        | "refund"
        | "expiry"
        | "adjustment"
      credit_type:
        | "ai_credits"
        | "voice_minutes"
        | "storage"
        | "knowledge"
        | "integrations"
        | "marketplace"
      developer_project_status: "draft" | "active" | "suspended" | "archived"
      document_status:
        | "uploaded"
        | "scanning"
        | "extracting"
        | "cleaning"
        | "chunking"
        | "embedding_ready"
        | "indexed"
        | "available"
        | "failed"
        | "reindex"
      execution_status:
        | "waiting"
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "cancelled"
        | "retrying"
      integration_auth_type:
        | "oauth2"
        | "api_key"
        | "basic"
        | "bearer"
        | "webhook"
        | "custom"
        | "none"
      integration_log_kind:
        | "request"
        | "response"
        | "error"
        | "retry"
        | "auth"
        | "connection"
        | "sync"
        | "webhook"
      integration_status:
        | "pending"
        | "healthy"
        | "warning"
        | "disconnected"
        | "expired"
        | "auth_error"
        | "rate_limited"
        | "paused"
        | "archived"
      invoice_status:
        | "draft"
        | "open"
        | "paid"
        | "void"
        | "uncollectible"
        | "archived"
      knowledge_source:
        | "pdf"
        | "word"
        | "excel"
        | "csv"
        | "txt"
        | "markdown"
        | "website"
        | "faq"
        | "manual"
        | "database"
        | "api"
        | "cloud_storage"
        | "notion"
        | "google_drive"
      knowledge_status: "draft" | "active" | "archived"
      marketing_alert_kind:
        | "low_credit"
        | "credit_exhaustion"
        | "high_burn"
        | "campaign_stopped"
        | "weak_performance"
        | "opportunity"
        | "optimization"
        | "buy_credits"
        | "upgrade_plan"
      marketing_alert_severity: "info" | "warning" | "critical"
      marketing_campaign_status:
        | "draft"
        | "pending_approval"
        | "scheduled"
        | "active"
        | "paused"
        | "completed"
        | "archived"
      marketing_channel:
        | "social"
        | "email"
        | "whatsapp"
        | "sms"
        | "search"
        | "display"
        | "video"
        | "content"
        | "events"
        | "affiliate"
      marketplace_category:
        | "workers"
        | "workflows"
        | "knowledge_packs"
        | "prompt_packs"
        | "voice_packs"
        | "templates"
        | "plugins"
        | "extensions"
        | "automation_packs"
      marketplace_license:
        | "free"
        | "paid"
        | "subscription"
        | "enterprise"
        | "trial"
        | "lifetime"
      marketplace_listing_status:
        | "draft"
        | "submitted"
        | "approved"
        | "rejected"
        | "published"
      memory_entry_status: "active" | "archived" | "expired"
      memory_event_type:
        | "created"
        | "updated"
        | "used"
        | "archived"
        | "expired"
        | "merged"
        | "summarized"
        | "deleted"
      memory_layer: "short_term" | "long_term" | "session" | "persistent"
      payment_provider:
        | "stripe"
        | "hyperpay"
        | "paytabs"
        | "moyasar"
        | "stc_pay"
        | "manual"
      plugin_status:
        | "installed"
        | "enabled"
        | "disabled"
        | "update_available"
        | "removed"
      prompt_scope: "workspace" | "worker" | "system" | "shared"
      subscription_status:
        | "trialing"
        | "active"
        | "past_due"
        | "paused"
        | "cancelled"
        | "expired"
      sync_mode: "manual" | "automatic" | "scheduled" | "realtime"
      sync_run_status:
        | "queued"
        | "running"
        | "completed"
        | "failed"
        | "conflict"
        | "cancelled"
      transfer_state: "pending" | "approved" | "completed" | "rejected"
      usage_category:
        | "worker"
        | "voice"
        | "api"
        | "knowledge"
        | "memory"
        | "storage"
        | "integration"
      voice_number_status:
        | "available"
        | "pending"
        | "verifying"
        | "connected"
        | "disconnected"
        | "archived"
      voice_number_type: "platform" | "byon" | "sip_trunk" | "pbx"
      voice_provider_kind:
        | "twilio"
        | "telnyx"
        | "vonage"
        | "plivo"
        | "sip"
        | "pbx"
        | "local"
        | "custom"
      voice_provider_status:
        | "prepared"
        | "pending"
        | "connected"
        | "disconnected"
        | "error"
        | "archived"
      webhook_direction: "incoming" | "outgoing"
      worker_status: "draft" | "active" | "paused" | "archived"
      workflow_status: "draft" | "published" | "paused" | "archived"
      workspace_role: "owner" | "admin" | "member" | "viewer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      approval_state: ["pending", "approved", "rejected", "cancelled"],
      billing_scope: [
        "workspace",
        "organization",
        "owner",
        "developer",
        "reseller",
      ],
      call_direction: ["inbound", "outbound"],
      call_status: [
        "queued",
        "ringing",
        "in_progress",
        "completed",
        "failed",
        "missed",
        "cancelled",
        "no_answer",
      ],
      creative_kind: [
        "image",
        "video",
        "reel",
        "short_video",
        "copywriting",
        "ad_copy",
        "social_post",
        "banner",
        "landing_page",
        "email_campaign",
        "whatsapp_message",
        "sms_campaign",
        "multi_platform",
      ],
      creative_status: [
        "draft",
        "queued",
        "running",
        "review",
        "approved",
        "rejected",
        "failed",
        "archived",
      ],
      credit_txn_kind: [
        "grant",
        "purchase",
        "consumption",
        "refund",
        "expiry",
        "adjustment",
      ],
      credit_type: [
        "ai_credits",
        "voice_minutes",
        "storage",
        "knowledge",
        "integrations",
        "marketplace",
      ],
      developer_project_status: ["draft", "active", "suspended", "archived"],
      document_status: [
        "uploaded",
        "scanning",
        "extracting",
        "cleaning",
        "chunking",
        "embedding_ready",
        "indexed",
        "available",
        "failed",
        "reindex",
      ],
      execution_status: [
        "waiting",
        "queued",
        "running",
        "completed",
        "failed",
        "cancelled",
        "retrying",
      ],
      integration_auth_type: [
        "oauth2",
        "api_key",
        "basic",
        "bearer",
        "webhook",
        "custom",
        "none",
      ],
      integration_log_kind: [
        "request",
        "response",
        "error",
        "retry",
        "auth",
        "connection",
        "sync",
        "webhook",
      ],
      integration_status: [
        "pending",
        "healthy",
        "warning",
        "disconnected",
        "expired",
        "auth_error",
        "rate_limited",
        "paused",
        "archived",
      ],
      invoice_status: [
        "draft",
        "open",
        "paid",
        "void",
        "uncollectible",
        "archived",
      ],
      knowledge_source: [
        "pdf",
        "word",
        "excel",
        "csv",
        "txt",
        "markdown",
        "website",
        "faq",
        "manual",
        "database",
        "api",
        "cloud_storage",
        "notion",
        "google_drive",
      ],
      knowledge_status: ["draft", "active", "archived"],
      marketing_alert_kind: [
        "low_credit",
        "credit_exhaustion",
        "high_burn",
        "campaign_stopped",
        "weak_performance",
        "opportunity",
        "optimization",
        "buy_credits",
        "upgrade_plan",
      ],
      marketing_alert_severity: ["info", "warning", "critical"],
      marketing_campaign_status: [
        "draft",
        "pending_approval",
        "scheduled",
        "active",
        "paused",
        "completed",
        "archived",
      ],
      marketing_channel: [
        "social",
        "email",
        "whatsapp",
        "sms",
        "search",
        "display",
        "video",
        "content",
        "events",
        "affiliate",
      ],
      marketplace_category: [
        "workers",
        "workflows",
        "knowledge_packs",
        "prompt_packs",
        "voice_packs",
        "templates",
        "plugins",
        "extensions",
        "automation_packs",
      ],
      marketplace_license: [
        "free",
        "paid",
        "subscription",
        "enterprise",
        "trial",
        "lifetime",
      ],
      marketplace_listing_status: [
        "draft",
        "submitted",
        "approved",
        "rejected",
        "published",
      ],
      memory_entry_status: ["active", "archived", "expired"],
      memory_event_type: [
        "created",
        "updated",
        "used",
        "archived",
        "expired",
        "merged",
        "summarized",
        "deleted",
      ],
      memory_layer: ["short_term", "long_term", "session", "persistent"],
      payment_provider: [
        "stripe",
        "hyperpay",
        "paytabs",
        "moyasar",
        "stc_pay",
        "manual",
      ],
      plugin_status: [
        "installed",
        "enabled",
        "disabled",
        "update_available",
        "removed",
      ],
      prompt_scope: ["workspace", "worker", "system", "shared"],
      subscription_status: [
        "trialing",
        "active",
        "past_due",
        "paused",
        "cancelled",
        "expired",
      ],
      sync_mode: ["manual", "automatic", "scheduled", "realtime"],
      sync_run_status: [
        "queued",
        "running",
        "completed",
        "failed",
        "conflict",
        "cancelled",
      ],
      transfer_state: ["pending", "approved", "completed", "rejected"],
      usage_category: [
        "worker",
        "voice",
        "api",
        "knowledge",
        "memory",
        "storage",
        "integration",
      ],
      voice_number_status: [
        "available",
        "pending",
        "verifying",
        "connected",
        "disconnected",
        "archived",
      ],
      voice_number_type: ["platform", "byon", "sip_trunk", "pbx"],
      voice_provider_kind: [
        "twilio",
        "telnyx",
        "vonage",
        "plivo",
        "sip",
        "pbx",
        "local",
        "custom",
      ],
      voice_provider_status: [
        "prepared",
        "pending",
        "connected",
        "disconnected",
        "error",
        "archived",
      ],
      webhook_direction: ["incoming", "outgoing"],
      worker_status: ["draft", "active", "paused", "archived"],
      workflow_status: ["draft", "published", "paused", "archived"],
      workspace_role: ["owner", "admin", "member", "viewer"],
    },
  },
} as const
