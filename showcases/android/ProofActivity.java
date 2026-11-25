package org.vminterface.proof;
import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.content.ContentResolver;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.io.OutputStream;

public class ProofActivity extends Activity {
  private static final byte[] RESULT="VM Interface Android APK functional proof\n".getBytes(StandardCharsets.UTF_8);
  private TextView status;
  private Button compute;
  private Uri directory;
  private String abi;
  private static String digest(byte[] data) throws Exception {
    StringBuilder result=new StringBuilder();
    for(byte b:MessageDigest.getInstance("SHA-256").digest(data))result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
    return result.toString();
  }
  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    abi=Build.SUPPORTED_ABIS.length>0?Build.SUPPORTED_ABIS[0]:"unknown";
    LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(24,24,24,24);
    status=new TextView(this);status.setTextSize(24);
    status.setText("Select authorized exchange directory\nAndroid SDK "+Build.VERSION.SDK_INT);
    layout.addView(status);
    Button select=new Button(this);select.setText("Select exchange folder");layout.addView(select);
    select.setOnClickListener(v->{
      Intent i=new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
      i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION|Intent.FLAG_GRANT_WRITE_URI_PERMISSION);
      startActivityForResult(i,1);
    });
    compute=new Button(this);compute.setText("Compute proof");layout.addView(compute);compute.setEnabled(false);
    compute.setOnClickListener(v->{
      if(directory==null||!abi.equals("arm64-v8a"))return;
      compute.setEnabled(false);
      try {
        ContentResolver resolver=getContentResolver();
        Uri parent=DocumentsContract.buildDocumentUriUsingTree(directory,DocumentsContract.getTreeDocumentId(directory));
        Uri children=DocumentsContract.buildChildDocumentsUriUsingTree(directory,DocumentsContract.getTreeDocumentId(directory));
        try(Cursor c=resolver.query(children,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
          if(c==null)throw new Exception("Directory not readable");
          while(c.moveToNext()){
            String name=c.getString(0);
            if("out-result.txt".equals(name)||"out-result.txt.sha256".equals(name))throw new Exception("Stale result");
          }
        }
        String hash=digest(RESULT);
        write(resolver,parent,"out-result.txt",RESULT);
        write(resolver,parent,"out-result.txt.sha256",(hash+"\n").getBytes(StandardCharsets.US_ASCII));
        status.setText("APKCOMPLETE "+abi+"\n"+hash);
      } catch(Exception e){status.setText("EXPORT FAILED");}
    });
    setContentView(layout);
  }
  private static void write(ContentResolver resolver,Uri parent,String name,byte[] bytes)throws Exception{
    Uri dest=DocumentsContract.createDocument(resolver,parent,"application/octet-stream",name);
    if(dest==null)throw new Exception("Document creation failed");
    try(Cursor c=resolver.query(dest,new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME},null,null,null)){
      if(c==null||!c.moveToFirst()||!name.equals(c.getString(0)))throw new Exception("Unexpected document name");
    }
    try(OutputStream out=resolver.openOutputStream(dest,"wt")){
      if(out==null)throw new Exception("Missing stream");
      out.write(bytes);
    }
  }
  @Override protected void onActivityResult(int request,int result,Intent data){
    super.onActivityResult(request,result,data);
    if(request!=1||result!=RESULT_OK||data==null||data.getData()==null)return;
    int flags=data.getFlags();
    if((flags&Intent.FLAG_GRANT_READ_URI_PERMISSION)==0||(flags&Intent.FLAG_GRANT_WRITE_URI_PERMISSION)==0){
      status.setText("EXCHANGE ACCESS DENIED");return;
    }
    directory=data.getData();
    if(!abi.equals("arm64-v8a")){status.setText("WRONG ABI "+abi);return;}
    status.setText("APKREADY "+abi+"\nAndroid SDK "+Build.VERSION.SDK_INT);
    compute.setEnabled(true);
  }
}
