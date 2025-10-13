#[repr(C)]
pub struct ByteArray {
    pub ptr: *mut u8,
    pub len: usize,
    pub cap: usize,
}

impl ByteArray {
    pub fn from_vec(mut vec: Vec<u8>) -> *mut ByteArray {
        let ptr = vec.as_mut_ptr();
        let len = vec.len();
        let cap = vec.capacity();
        std::mem::forget(vec);
        Box::into_raw(Box::new(ByteArray { ptr, len, cap }))
    }

    pub fn empty() -> *mut ByteArray {
        ByteArray::from_vec(Vec::new())
    }
}
