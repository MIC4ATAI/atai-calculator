
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "calc_events": {
                  Row: {
                    "actor": string,"actor_id": string | null,"created_at": string,"field": string,"id": number,"new_value": Json | null,"old_value": Json | null,"org_id": string,"session_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "actor": string,"actor_id"?: string | null,"created_at"?: string,"field": string,"id"?: never,"new_value"?: Json | null,"old_value"?: Json | null,"org_id": string,"session_id": string
                  }
                  Update: {
                    "actor"?: string,"actor_id"?: string | null,"created_at"?: string,"field"?: string,"id"?: never,"new_value"?: Json | null,"old_value"?: Json | null,"org_id"?: string,"session_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calc_events_session_id_org_id_fkey"
      columns: ["session_id","org_id"]
isOneToOne: false
      referencedRelation: "calc_sessions"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"calc_sessions": {
                  Row: {
                    "consultant_id": string,"created_at": string,"id": string,"inputs": NonNullable<Json>,"mix_kh": number | null,"org_id": string,"params": NonNullable<Json>,"reply": string,"revealed": boolean,"status": string,"token": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "consultant_id": string,"created_at"?: string,"id"?: string,"inputs"?: NonNullable<Json>,"mix_kh"?: number | null,"org_id": string,"params"?: NonNullable<Json>,"reply"?: string,"revealed"?: boolean,"status"?: string,"token"?: string,"updated_at"?: string
                  }
                  Update: {
                    "consultant_id"?: string,"created_at"?: string,"id"?: string,"inputs"?: NonNullable<Json>,"mix_kh"?: number | null,"org_id"?: string,"params"?: NonNullable<Json>,"reply"?: string,"revealed"?: boolean,"status"?: string,"token"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calc_sessions_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"calc_snapshots": {
                  Row: {
                    "calc_version": string,"created_at": string,"id": string,"inputs": NonNullable<Json>,"mix": NonNullable<Json>,"org_id": string,"params": NonNullable<Json>,"result": NonNullable<Json>,"session_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "calc_version": string,"created_at"?: string,"id"?: string,"inputs": NonNullable<Json>,"mix": NonNullable<Json>,"org_id": string,"params": NonNullable<Json>,"result": NonNullable<Json>,"session_id": string
                  }
                  Update: {
                    "calc_version"?: string,"created_at"?: string,"id"?: string,"inputs"?: NonNullable<Json>,"mix"?: NonNullable<Json>,"org_id"?: string,"params"?: NonNullable<Json>,"result"?: NonNullable<Json>,"session_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "calc_snapshots_session_id_org_id_fkey"
      columns: ["session_id","org_id"]
isOneToOne: false
      referencedRelation: "calc_sessions"
      referencedColumns: ["id","org_id"]
    }
                  ]
                },"memberships": {
                  Row: {
                    "created_at": string,"id": string,"org_id": string,"role": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"id"?: string,"org_id": string,"role": string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"id"?: string,"org_id"?: string,"role"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "memberships_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    }
                  ]
                },"organizations": {
                  Row: {
                    "brand": NonNullable<Json>,"created_at": string,"default_params": NonNullable<Json>,"id": string,"name": string,"nip": string | null,"privacy_policy_url": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "brand"?: NonNullable<Json>,"created_at"?: string,"default_params"?: NonNullable<Json>,"id"?: string,"name": string,"nip"?: string | null,"privacy_policy_url"?: string | null
                  }
                  Update: {
                    "brand"?: NonNullable<Json>,"created_at"?: string,"default_params"?: NonNullable<Json>,"id"?: string,"name"?: string,"nip"?: string | null,"privacy_policy_url"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"platform_operators": {
                  Row: {
                    "created_at": string,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"profiles": {
                  Row: {
                    "created_at": string,"full_name": string | null,"phone": string | null,"photo_url": string | null,"signature": string | null,"user_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"full_name"?: string | null,"phone"?: string | null,"photo_url"?: string | null,"signature"?: string | null,"user_id": string
                  }
                  Update: {
                    "created_at"?: string,"full_name"?: string | null,"phone"?: string | null,"photo_url"?: string | null,"signature"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"usage_events": {
                  Row: {
                    "consultant_id": string | null,"created_at": string,"event_type": string,"id": number,"org_id": string,"session_id": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "consultant_id"?: string | null,"created_at"?: string,"event_type": string,"id"?: never,"org_id": string,"session_id"?: string | null
                  }
                  Update: {
                    "consultant_id"?: string | null,"created_at"?: string,"event_type"?: string,"id"?: never,"org_id"?: string,"session_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_events_org_id_fkey"
      columns: ["org_id"]
isOneToOne: false
      referencedRelation: "organizations"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "usage_events_session_id_fkey"
      columns: ["session_id"]
isOneToOne: false
      referencedRelation: "calc_sessions"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "create_calc_session":
{ Args: { "p_org_id": string }; Returns: {
              "consultant_id": string,
"created_at": string,
"id": string,
"inputs": NonNullable<Json>,
"mix_kh": number | null,
"org_id": string,
"params": NonNullable<Json>,
"reply": string,
"revealed": boolean,
"status": string,
"token": string,
"updated_at": string
            }
                          SetofOptions: {
        from: "*"
        to: "calc_sessions"
        isOneToOne: true
        isSetofReturn: false
      } },
"guest_patch_calc_session":
{ Args: { "p_mix_kh"?: number,"p_patch": Json,"p_reply"?: string,"p_token": string }; Returns: boolean
                           },
"patch_calc_session_inputs":
{ Args: { "p_patch": Json,"p_session_id": string }; Returns: undefined
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
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
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            
          }
        }
} as const
