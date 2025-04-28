package org.vminterface.proof;
import android.app.Activity;
import android.os.Bundle;
import android.os.Build;
import android.content.Intent;
import android.widget.Button;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.io.OutputStream;

public class ProofActivity extends Activity {
  private static final byte[] RESULT="VM Interface Android APK functional proof\n".getBytes(StandardCharsets.UTF_8);
  private boolean computed;
  private TextView status;
  private static String digest(byte[] data) throws Exception {
    StringBuilder result=new StringBuilder();
    for(byte b:MessageDigest.getInstance("SHA-256").digest(data))result.append(String.format(java.util.Locale.ROOT,"%02x",b&255));
    return result.toString();
  }
  @Override public void onCreate(Bundle state){
    super.onCreate(state);
    LinearLayout layout=new LinearLayout(this); layout.setOrientation(LinearLayout.VERTICAL);layout.setPadding(24,24,24,24);
    status=new TextView(this);status.setTextSize(24);
    String abi=Build.SUPPORTED_ABIS.length>0?Build.SUPPORTED_ABIS[0]:"unknown";
    status.setText("APKREADY "+abi+"\nAndroid SDK "+Build.VERSION.SDK_INT);
    layout.addView(status);
    Button compute=new Button(this);compute.setText("Compute proof");layout.addView(compute);
    compute.setOnClickListener(v->{try{
      if(!abi.equals("arm64-v8a")){status.setText("WRONG ABI "+abi);return;}
      computed=true;status.setText("APKCOMPLETE "+abi+"\n"+digest(RESULT));
    }catch(Exception e){status.setText("COMPUTE FAILED");}});
    Button export=new Button(this);export.setText("Export result");layout.addView(export);
    export.setOnClickListener(v->save(1,"out-result.txt"));
    Button marker=new Button(this);marker.setText("Export checksum");layout.addView(marker);
    marker.setOnClickListener(v->save(2,"out-result.txt.sha256"));
    setContentView(layout);
  }
  private void save(int code,String filename){
    if(!computed){Toast.makeText(this,"Compute first",Toast.LENGTH_SHORT).show();return;}
    Intent i=new Intent(Intent.ACTION_CREATE_DOCUMENT);i.addCategory(Intent.CATEGORY_OPENABLE);i.setType("application/octet-stream");i.putExtra(Intent.EXTRA_TITLE,filename);startActivityForResult(i,code);
  }
  @Override protected void onActivityResult(int request,int result,Intent data){
    super.onActivityResult(request,result,data);
    if(result!=RESULT_OK||data==null||data.getData()==null||!computed)return;
    try(OutputStream out=getContentResolver().openOutputStream(data.getData(),"wt")){
      if(out==null)throw new Exception("missing stream");
      out.write(request==1?RESULT:(digest(RESULT)+"\n").getBytes(StandardCharsets.US_ASCII));
      Toast.makeText(this,"Export complete",Toast.LENGTH_SHORT).show();
    }catch(Exception e){Toast.makeText(this,"Export failed",Toast.LENGTH_LONG).show();}
  }
}
