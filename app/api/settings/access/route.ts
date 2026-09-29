import { NextResponse } from 'next/server';
import { currentUser } from '@/lib/session';
import { allRoles, readDb } from '@/lib/store';
import { hasPermission, permissionCatalog } from '@/lib/permissions';

// Settings discovers capabilities independently of the user-list permission.
// No users, credential values or provider calls are included in this response.
export async function GET() {
 const user=await currentUser();
 if(!user)return NextResponse.json({error:'Unauthorized'},{status:401});
 const db=await readDb();
 const actorPermissions=permissionCatalog.filter(item=>hasPermission(db,user,item.key)).map(item=>item.key);
 const privileged=actorPermissions.includes('admin.access');
 const viewPermissions=privileged&&actorPermissions.includes('permissions.view');
 return NextResponse.json({actorPermissions,roles:privileged?allRoles:[],permissions:viewPermissions?db.rolePermissions:{},permissionCatalog:viewPermissions?permissionCatalog:[],users:[]});
}
