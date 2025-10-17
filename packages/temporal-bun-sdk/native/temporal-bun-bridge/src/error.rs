use std::cell::RefCell;

thread_local! {
    static LAST_ERROR: RefCell<Option<Vec<u8>>> = RefCell::new(None);
}

pub fn set_error(message: impl Into<String>) {
    let bytes = message.into().into_bytes();
    LAST_ERROR.with(|cell| {
        *cell.borrow_mut() = Some(bytes);
    });
}

pub fn take_error(len_out: *mut usize) -> *const u8 {
    LAST_ERROR.with(|cell| {
        let mut borrowed = cell.borrow_mut();
        if let Some(bytes) = borrowed.take() {
            let len = bytes.len();
            let ptr = bytes.as_ptr();
            std::mem::forget(bytes);
            if !len_out.is_null() {
                unsafe {
                    *len_out = len;
                }
            }
            ptr
        } else {
            if !len_out.is_null() {
                unsafe {
                    *len_out = 0;
                }
            }
            std::ptr::null()
        }
    })
}

pub unsafe fn free_error(ptr: *mut u8, len: usize) {
    if ptr.is_null() || len == 0 {
        return;
    }
    let slice = std::slice::from_raw_parts_mut(ptr, len);
    drop(Box::from_raw(slice));
}
