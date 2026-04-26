export const hashContent = async (textContent: string): Promise<string> => {
  // Convert text to Uint8Array
  const encoder = new TextEncoder();
  const textBytes = encoder.encode(textContent);
  
  // Generate SHA-256 hash
  const hashBuffer = await crypto.subtle.digest('SHA-256', textBytes);
  
  // Convert to hexadecimal string
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  
  return hashHex;
}; 