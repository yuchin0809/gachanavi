// Admin SDK はサービスアカウントの秘密鍵を扱うため、クライアントバンドルに含めない
import "server-only";

export { FirebaseConfigError, getAdminAuth, getAdminFirestore } from "./adminApp";
